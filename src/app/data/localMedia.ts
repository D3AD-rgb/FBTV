/**
 * Your own films and episodes from the PC's media folder (media/{movies,series,other}).
 * The index (local-media.json) carries ids and names only; the files, artwork and subtitles
 * are streamed by the library server, so they play only when the TV reads the library from
 * the PC (Settings › Sources), never from the copy bundled into the app.
 */
import { signal } from '@preact/signals';
import type { CatalogueChannel } from '../../shared/model.ts';
import { getJSON } from './http.ts';
import { library } from './sourceLibrary.ts';

export interface LocalSubtitle {
  id: number;
  label: string;
  language?: string;
}

export interface LocalItem {
  id: string;
  kind: 'movie' | 'episode' | 'other';
  title: string;
  year?: number;
  series?: string;
  season?: number;
  episode?: number;
  ext: string;
  size: number;
  modified: string;
  subtitles: LocalSubtitle[];
  art?: boolean;
}

export interface LocalSeason {
  season: number;
  episodes: LocalItem[];
}

export interface LocalSeries {
  title: string;
  seasons: LocalSeason[];
  /** First episode with artwork, used as the series poster. */
  poster?: LocalItem;
  count: number;
}

export type LocalState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'needs-server' }
  | { status: 'ready'; items: LocalItem[]; base: string }
  | { status: 'error'; reason: string };

export const localMedia = signal<LocalState>({ status: 'idle' });

/** Loads the index once per library base (call from screens that show local media). */
export function loadLocalMedia(): void {
  const lib = library.value;
  if (lib.status !== 'ready') return;
  if (lib.origin !== 'server') {
    localMedia.value = { status: 'needs-server' };
    return;
  }
  const cur = localMedia.value;
  if (cur.status === 'loading' || (cur.status === 'ready' && cur.base === lib.base)) return;
  localMedia.value = { status: 'loading' };
  getJSON<{ items: LocalItem[] }>(`${lib.base}local-media.json`, { timeoutMs: 15000, maxBytes: 20 * 1024 * 1024 }).then(
    (d) => (localMedia.value = { status: 'ready', items: d && d.items ? d.items : [], base: lib.base }),
    () => (localMedia.value = { status: 'error', reason: 'The PC did not send its media list. Is "npm run library:serve" running?' }),
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The episode's own name, or '' when the file only had a number ("Episode 3") or the show's name. Pure. */
export function episodeName(it: LocalItem): string {
  return it.title && it.title !== it.series && !/^episode\s*\d*$/i.test(it.title) ? it.title : '';
}

/** "Title (2019)", "Show · S01E02" or the file title. Pure. */
export function localLabel(it: LocalItem): string {
  if (it.kind === 'episode' && it.series) {
    const code = it.season !== undefined && it.episode !== undefined ? `S${pad(it.season)}E${pad(it.episode)}` : '';
    return [it.series, code, episodeName(it)].filter(Boolean).join(' · ');
  }
  return it.year ? `${it.title} (${it.year})` : it.title;
}

/** A playable channel for one file; ids are "local:<media id>". Pure. */
export function localChannel(it: LocalItem, base: string): CatalogueChannel {
  const root = `${base}media/${it.id}`;
  return {
    id: `local:${it.id}`,
    name: localLabel(it),
    logo: it.art ? `${root}/art` : undefined,
    categories: [it.kind === 'movie' ? 'Movies' : it.kind === 'episode' ? 'Series' : 'Other'],
    streams: [{ id: `local:${it.id}#0`, url: `${root}.${it.ext}`, source: 'your PC', feedName: 'From your PC' }],
    sources: ['your PC'],
    playback: {
      resumeKey: `local:${it.id}`,
      subtitles: it.subtitles.map((s) => ({ url: `${root}/sub/${s.id}.vtt`, label: s.label, language: s.language })),
    },
  };
}

/** Episodes grouped by series and season, in episode order; series A–Z. Pure. */
export function groupSeries(items: LocalItem[]): LocalSeries[] {
  const by = new Map<string, Map<number, LocalItem[]>>();
  for (const it of items) {
    if (it.kind !== 'episode' || !it.series) continue;
    const key = it.series;
    let seasons = by.get(key);
    if (!seasons) by.set(key, (seasons = new Map()));
    const s = it.season !== undefined ? it.season : 0;
    const list = seasons.get(s);
    if (list) list.push(it);
    else seasons.set(s, [it]);
  }
  const out: LocalSeries[] = [];
  by.forEach((seasons, title) => {
    const list: LocalSeason[] = Array.from(seasons.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([season, eps]) => ({
        season,
        episodes: eps.slice().sort((a, b) => (a.episode || 0) - (b.episode || 0) || a.title.localeCompare(b.title)),
      }));
    const all = list.reduce<LocalItem[]>((a, s) => a.concat(s.episodes), []);
    out.push({ title, seasons: list, poster: all.filter((e) => e.art)[0], count: all.length });
  });
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

/** Items whose name, series or year matches every word of the query. Pure. */
export function searchLocal(items: LocalItem[], query: string): LocalItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return items.filter((it) => {
    const text = `${it.title} ${it.series || ''} ${it.year || ''}`.toLowerCase();
    return words.every((w) => text.indexOf(w) >= 0);
  });
}
