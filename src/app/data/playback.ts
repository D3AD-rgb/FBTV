/**
 * App-wide playback: one persistent <video> element (the TV has one hardware decoder) that
 * is positioned either inside the Live deck preview box or full screen. Playing a channel
 * tries its streams in order (main feed first) and falls back to the next stream when one
 * fails for a reason another feed might not share.
 */
import { signal } from '@preact/signals';
import type { CatalogueChannel, CatalogueStream } from '../../shared/model.ts';
import { Player } from '../player/player.ts';
import type { PlayerErrorCode } from '../player/types.ts';
import { readJSON, writeJSON } from '../platform/storage.ts';
import { showToast } from '../ui/toast.tsx';
import { recordWatched } from './library.ts';

export type VideoLayout =
  | { mode: 'hidden' }
  | { mode: 'box'; left: number; top: number; width: number; height: number }
  | { mode: 'full' };

export const videoLayout = signal<VideoLayout>({ mode: 'hidden' });

export interface NowPlaying {
  channel: CatalogueChannel;
  stream: CatalogueStream;
  streamIndex: number;
}

export const nowPlaying = signal<NowPlaying | null>(null);

/**
 * Channels the player steps through with Up/Down/CH±, and where the list came from. `channels`
 * carries the channel objects for lists that are not in the built-in catalogue (the library).
 */
export const playContext = signal<{ ids: string[]; label: string; channels?: CatalogueChannel[] }>({ ids: [], label: '' });

/** Finds a channel by id in the current play context first, then via `fallback`. */
export function resolveChannel(id: string, fallback: (id: string) => CatalogueChannel | undefined): CatalogueChannel | undefined {
  const list = playContext.value.channels;
  if (list) for (const c of list) if (c.id === id) return c;
  return fallback(id);
}

/** The channel played before the current one (Blue key / "last channel"). */
export const previousChannelId = signal<string | null>(null);

let player: Player | null = null;
let videoEl: HTMLVideoElement | null = null;
let attempt = 0;

/** Errors where another stream of the same channel may still work. */
const TRY_NEXT_STREAM: PlayerErrorCode[] = ['network', 'not-found', 'forbidden', 'timeout', 'rejected', 'decode', 'unsupported-format', 'cors'];
const MAX_STREAMS_TRIED = 3;

export function bindVideo(el: HTMLVideoElement): Player {
  if (player && videoEl === el) return player;
  if (player) player.destroy();
  videoEl = el;
  player = new Player(el, { startupTimeoutMs: 15000 });
  return player;
}

export function getPlayer(): Player | null {
  return player;
}

export function streamLabel(s: CatalogueStream): string {
  const parts: string[] = [];
  if (s.feedName) parts.push(s.feedName);
  if (s.probe) parts.push(`${s.probe.height}p verified`);
  else if (s.quality) parts.push(`${s.quality} advertised`);
  return parts.join(' · ') || 'Main feed';
}

/** Plays a channel, starting at `startIndex` and falling back through its other streams. */
export async function playChannel(channel: CatalogueChannel, startIndex = 0): Promise<boolean> {
  if (!player) return false;
  endResume();
  const current = nowPlaying.value;
  if (current && current.channel.id !== channel.id) previousChannelId.value = current.channel.id;
  const my = ++attempt;
  const streams = channel.streams;
  const last = Math.min(streams.length, startIndex + MAX_STREAMS_TRIED);
  for (let i = startIndex; i < last; i++) {
    const stream = streams[i]!;
    nowPlaying.value = { channel, stream, streamIndex: i };
    const ok = await player.play({ url: stream.url, subtitles: channel.playback ? channel.playback.subtitles : undefined });
    if (my !== attempt) return false; // superseded by a newer request
    if (ok) {
      recordWatched(channel.id);
      if (channel.playback && channel.playback.resumeKey) startResume(channel.playback.resumeKey);
      return true;
    }
    const err = player.error.value;
    if (!err || TRY_NEXT_STREAM.indexOf(err.code) < 0) break;
  }
  return false;
}

// ------------------------------------------------------------------ resume (on-demand items)

let resumeTimer: ReturnType<typeof setInterval> | null = null;
let resumeKey: string | null = null;
const resumeKeyOf = (k: string) => `resume:${k}`;

function saveResume(): void {
  if (!player || !resumeKey) return;
  const pos = player.position();
  const dur = player.duration();
  if (!dur || pos < 5) return;
  writeJSON(resumeKeyOf(resumeKey), resumeValue(pos, dur));
}

/** Position to save: the last minute (or last 5% of a short video) counts as finished, so 0. Pure. */
export function resumeValue(pos: number, dur: number): number {
  return pos > dur - Math.min(60, dur * 0.05) ? 0 : Math.floor(pos);
}

/** Saved position in seconds for an on-demand item (0 when none). */
export function resumePosition(key: string): number {
  return readJSON<number>(resumeKeyOf(key), 0);
}

function startResume(key: string): void {
  const p = player;
  if (!p) return;
  const saved = resumePosition(key);
  if (saved > 30) {
    p.seek(saved);
    showToast(`Resumed at ${Math.floor(saved / 60)}:${String(Math.floor(saved % 60)).padStart(2, '0')}`);
  }
  resumeKey = key;
  resumeTimer = setInterval(() => {
    if (player && player.status.value === 'playing') saveResume();
  }, 10000);
}

function endResume(): void {
  saveResume();
  if (resumeTimer) clearInterval(resumeTimer);
  resumeTimer = null;
  resumeKey = null;
}

/** Whether the item playing now is on-demand (seekable, resumable). */
export function isOnDemand(channel: CatalogueChannel | null | undefined): boolean {
  return !!channel && !!channel.playback && !!channel.playback.resumeKey;
}

export function stopPlayback(): void {
  endResume();
  attempt++;
  if (player) player.stop();
  nowPlaying.value = null;
}
