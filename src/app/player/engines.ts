/**
 * Playback engines bound to a single <video> element.
 *  - native: the TV's hardware player (HLS via <source type=…mpegurl>, MPEG-TS, MP4). No CORS needed.
 *  - hlsjs:  hls.js over Media Source Extensions (needs CORS from the stream server).
 *  - mpegts: mpegts.js over MSE for raw MPEG-TS / FLV (needs CORS).
 * MSE libraries ship as separate classic scripts in vendor/ and load on first use.
 */
import type Hls from 'hls.js';
import type { ErrorData } from 'hls.js';
import type { Engine, EngineId, PlayerError, StreamSource, Track } from './types.ts';
import { detectKind, httpStatusToCode, mediaErrorToCode } from './policy.ts';
import { loadScript } from './loadScript.ts';

type HlsCtor = typeof Hls;

interface MpegtsPlayer {
  attachMediaElement(el: HTMLMediaElement): void;
  load(): void;
  unload(): void;
  detachMediaElement(): void;
  destroy(): void;
  on(event: string, cb: (...args: unknown[]) => void): void;
}
interface MpegtsLib {
  isSupported(): boolean;
  createPlayer(source: Record<string, unknown>, config?: Record<string, unknown>): MpegtsPlayer;
  Events: { ERROR: string };
  ErrorTypes: { NETWORK_ERROR: string; MEDIA_ERROR: string; OTHER_ERROR: string };
}

const VENDOR_HLS = 'vendor/hls.min.js';
const VENDOR_MPEGTS = 'vendor/mpegts.js';

/** Clears whatever an engine left on the element so the next engine starts clean. */
export function resetVideo(video: HTMLVideoElement): void {
  try {
    video.pause();
  } catch {
    /* ignore */
  }
  while (video.firstChild) video.removeChild(video.firstChild);
  video.removeAttribute('src');
  try {
    video.load();
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------- native
interface NativeAudioTrack {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}

class NativeEngine implements Engine {
  readonly id: EngineId = 'native';
  private video: HTMLVideoElement | null = null;
  private cleanup: (() => void) | null = null;

  async load(src: StreamSource, video: HTMLVideoElement, onError: (e: PlayerError) => void): Promise<void> {
    this.video = video;
    const fail = () => onError({ code: mediaErrorToCode(video.error ? video.error.code : undefined) });
    const kind = src.kind || detectKind(src.url);
    if (kind === 'hls') {
      // A <source> with the HLS MIME type routes to the webOS HLS pipeline reliably (webOS 5 needs it).
      const source = document.createElement('source');
      source.type = 'application/vnd.apple.mpegurl';
      source.src = src.url;
      // With <source>, load failures fire on the source element, not on the video.
      const onSourceError = () => onError({ code: 'unsupported-format', detail: 'source rejected' });
      source.addEventListener('error', onSourceError);
      video.appendChild(source);
      video.addEventListener('error', fail);
      this.cleanup = () => {
        source.removeEventListener('error', onSourceError);
        video.removeEventListener('error', fail);
      };
    } else {
      video.addEventListener('error', fail);
      video.src = src.url;
      this.cleanup = () => video.removeEventListener('error', fail);
    }
    video.load();
  }

  private native(): NativeAudioTrack[] {
    const list = this.video ? (this.video as unknown as { audioTracks?: ArrayLike<NativeAudioTrack> }).audioTracks : null;
    return list ? Array.prototype.slice.call(list) : [];
  }

  audioTracks(): Track[] {
    return this.native().map((t, i) => ({
      id: t.id || String(i),
      label: t.label || t.language || `Audio ${i + 1}`,
      language: t.language || undefined,
      active: !!t.enabled,
    }));
  }

  setAudioTrack(id: string): void {
    this.native().forEach((t, i) => {
      t.enabled = (t.id || String(i)) === id;
    });
  }

  subtitleTracks(): Track[] {
    const tt = this.video ? this.video.textTracks : null;
    const out: Track[] = [];
    if (!tt) return out;
    for (let i = 0; i < tt.length; i++) {
      const t = tt[i]!;
      if (t.kind !== 'subtitles' && t.kind !== 'captions') continue;
      out.push({ id: String(i), label: t.label || t.language || `Subtitles ${i + 1}`, language: t.language, active: t.mode === 'showing' });
    }
    return out;
  }

  setSubtitleTrack(id: string | null): void {
    const tt = this.video ? this.video.textTracks : null;
    if (!tt) return;
    for (let i = 0; i < tt.length; i++) tt[i]!.mode = String(i) === id ? 'showing' : 'disabled';
  }

  destroy(): void {
    if (this.cleanup) this.cleanup();
    this.cleanup = null;
    if (this.video) resetVideo(this.video);
    this.video = null;
  }
}

// ---------------------------------------------------------------- hls.js
class HlsJsEngine implements Engine {
  readonly id: EngineId = 'hlsjs';
  private hls: Hls | null = null;

  async load(src: StreamSource, video: HTMLVideoElement, onError: (e: PlayerError) => void): Promise<void> {
    await loadScript(VENDOR_HLS);
    const HlsLib = (window as unknown as { Hls?: HlsCtor }).Hls;
    if (!HlsLib || !HlsLib.isSupported()) throw new Error('hls.js not supported on this engine');
    const hls = new HlsLib({
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 30,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      manifestLoadingTimeOut: 10000,
      manifestLoadingMaxRetry: 1,
      levelLoadingTimeOut: 10000,
      fragLoadingTimeOut: 15000,
      startLevel: -1,
      capLevelToPlayerSize: false,
    });
    this.hls = hls;
    hls.on(HlsLib.Events.ERROR, (_evt: string, data: ErrorData) => {
      if (!data.fatal) return;
      if (data.type === HlsLib.ErrorTypes.NETWORK_ERROR) {
        const status = data.response && data.response.code ? data.response.code : 0;
        onError({ code: httpStatusToCode(status), detail: data.details });
      } else if (data.type === HlsLib.ErrorTypes.MEDIA_ERROR) {
        onError({ code: 'decode', detail: data.details });
      } else {
        onError({ code: 'unsupported-format', detail: data.details });
      }
    });
    hls.attachMedia(video);
    hls.loadSource(src.url);
  }

  audioTracks(): Track[] {
    const h = this.hls;
    if (!h) return [];
    return h.audioTracks.map((t, i) => ({
      id: String(i),
      label: t.name || t.lang || `Audio ${i + 1}`,
      language: t.lang,
      active: h.audioTrack === i,
    }));
  }

  setAudioTrack(id: string): void {
    if (this.hls) this.hls.audioTrack = Number(id);
  }

  subtitleTracks(): Track[] {
    const h = this.hls;
    if (!h) return [];
    return h.subtitleTracks.map((t, i) => ({
      id: String(i),
      label: t.name || t.lang || `Subtitles ${i + 1}`,
      language: t.lang,
      active: h.subtitleTrack === i,
    }));
  }

  setSubtitleTrack(id: string | null): void {
    if (this.hls) this.hls.subtitleTrack = id == null ? -1 : Number(id);
  }

  destroy(): void {
    if (this.hls) {
      const media = this.hls.media;
      this.hls.destroy();
      if (media) resetVideo(media as HTMLVideoElement);
    }
    this.hls = null;
  }
}

// ---------------------------------------------------------------- mpegts.js
class MpegtsEngine implements Engine {
  readonly id: EngineId = 'mpegts';
  private player: MpegtsPlayer | null = null;
  private video: HTMLVideoElement | null = null;

  async load(src: StreamSource, video: HTMLVideoElement, onError: (e: PlayerError) => void): Promise<void> {
    await loadScript(VENDOR_MPEGTS);
    const lib = (window as unknown as { mpegts?: MpegtsLib }).mpegts;
    if (!lib || !lib.isSupported()) throw new Error('mpegts.js not supported on this engine');
    const kind = src.kind || detectKind(src.url);
    const player = lib.createPlayer(
      { type: kind === 'flv' ? 'flv' : 'mpegts', isLive: true, url: src.url },
      { enableWorker: false, lazyLoad: false, liveBufferLatencyChasing: true, autoCleanupSourceBuffer: true },
    );
    this.player = player;
    this.video = video;
    player.on(lib.Events.ERROR, (type: unknown, detail: unknown, info: unknown) => {
      const status = info && typeof info === 'object' && 'code' in info ? Number((info as { code: number }).code) : 0;
      if (type === lib.ErrorTypes.NETWORK_ERROR) onError({ code: httpStatusToCode(status), detail: String(detail) });
      else if (type === lib.ErrorTypes.MEDIA_ERROR) onError({ code: 'decode', detail: String(detail) });
      else onError({ code: 'unsupported-format', detail: String(detail) });
    });
    player.attachMediaElement(video);
    player.load();
  }

  audioTracks(): Track[] {
    return [];
  }
  setAudioTrack(): void {
    /* single audio track */
  }
  subtitleTracks(): Track[] {
    return [];
  }
  setSubtitleTrack(): void {
    /* not supported */
  }

  destroy(): void {
    if (this.player) {
      try {
        this.player.unload();
        this.player.detachMediaElement();
        this.player.destroy();
      } catch {
        /* ignore */
      }
    }
    if (this.video) resetVideo(this.video);
    this.player = null;
    this.video = null;
  }
}

export function createEngine(id: EngineId): Engine {
  if (id === 'hlsjs') return new HlsJsEngine();
  if (id === 'mpegts') return new MpegtsEngine();
  return new NativeEngine();
}
