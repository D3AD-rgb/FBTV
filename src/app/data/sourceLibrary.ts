/**
 * The PC-built source library, as consumed on the TV (Rule 10).
 *
 * The TV cannot read folders on the PC. `npm run library:refresh` writes a compact export
 * (registry + channel shards + football/sports catalogs) that is either bundled into the
 * app package (library/…) or served on the home network by `npm run library:serve`; the
 * server address is set in Settings › Sources. Dropdowns are built from registry.json, so a
 * new playlist or profile on the PC appears after the next refresh — nothing is hard-coded.
 */
import { signal } from '@preact/signals';
import type { CatalogueChannel, CatalogueStream } from '../../shared/model.ts';
import { getJSON } from './http.ts';
import { readJSON, writeJSON } from '../platform/storage.ts';

export interface LibItem {
  id: string;
  name: string;
  group: string;
  type: string;
  contentType: string;
  languages: string[];
  channels: number;
  status: string;
  validation: { checked: number; reachable: number; playbackConfirmed: number; untested: number };
  note?: string;
  error?: string;
  select?: Record<string, string>;
  catalog?: string;
  url?: string;
}

export interface LibRegistry {
  schema: 1;
  generatedAt: string;
  shards: Record<string, { file: string; channels: number; note?: string }>;
  groups: string[];
  items: LibItem[];
}

export interface CompactChannel {
  i: string;
  n: string;
  a?: string[];
  c?: string;
  l?: string[];
  g?: string[];
  o?: string;
  e?: string;
  sp?: string[];
  f?: string;
  pay?: 1;
  k?: 'r';
  t?: string[];
  p: 0 | 1;
  r: string[];
  st: { u: string; s: string; v: string; q?: string; x?: string[]; m?: string }[];
}

/** A library channel adapted to the app's channel model, plus library-only fields. */
export interface LibChannel extends CatalogueChannel {
  playable: boolean;
  football?: string;
  payTvBrand?: boolean;
  repos: string[];
  radio: boolean;
  /** Validation of the best stream: untested | reachable | temporarily_unavailable | playback_confirmed | playback_failed */
  validation: string;
  /** In the PC's news / sports lists (which also match group names, not exported). */
  inNews: boolean;
  inSports: boolean;
  /** Import status of the best stream when the channel has nothing the TV can attempt. */
  reason?: string;
}

const REASONS: Record<string, string> = {
  restricted: 'link withheld (pay-TV relay)',
  unsupported_format: 'format or protocol the TV cannot play',
  requires_provider_access: 'needs provider or ISP access',
  malformed: 'malformed entry',
  test_fixture: 'test file',
};

/** One-line status for a library channel, shown in lists and tiles. Never claims more than was checked. */
export function libStatus(c: LibChannel): string {
  if (!c.playable) return `Unavailable · ${(c.reason && REASONS[c.reason]) || c.reason || 'no stream the TV can attempt'}`;
  switch (c.validation) {
    case 'playback_confirmed':
      return 'Playback confirmed at last check';
    case 'reachable':
      return 'Answered at last check';
    case 'temporarily_unavailable':
      return 'Did not answer at last check';
    case 'playback_failed':
      return 'Playback failed at last check';
    default:
      return 'Untested';
  }
}

export function isLibChannel(c: CatalogueChannel): c is LibChannel {
  return typeof (c as LibChannel).playable === 'boolean' && Array.isArray((c as LibChannel).repos);
}

export type LibraryState =
  | { status: 'loading' }
  | { status: 'missing'; reason: string }
  | { status: 'ready'; registry: LibRegistry; origin: 'bundled' | 'server'; base: string };

export const library = signal<LibraryState>({ status: 'loading' });

const SERVER_KEY = 'library:server';

export function libraryServer(): string {
  return readJSON<string>(SERVER_KEY, '');
}

export function setLibraryServer(url: string): void {
  writeJSON(SERVER_KEY, url.trim());
}

const shardCache = new Map<string, LibChannel[]>();
const catalogCache = new Map<string, unknown>();

const has = (l: string[] | undefined, v: string) => !!l && l.indexOf(v) >= 0;

export function adapt(c: CompactChannel): LibChannel {
  const streams: CatalogueStream[] = c.st.map((s, idx) => {
    const cs: CatalogueStream = { id: `${c.i}#${idx}`, url: s.u, source: c.r[0] || 'library' };
    if (s.q) cs.quality = s.q;
    if (s.x) cs.labels = s.x.filter((x) => x === 'geo-blocked' || x === 'not-24-7').map((x) => (x === 'geo-blocked' ? 'Geo-blocked' : 'Not 24/7'));
    if (s.x && s.x.indexOf('needs-headers') >= 0) cs.needsHeaders = true;
    if (s.m) {
      const [w, h] = s.m.split('x').map(Number) as [number, number];
      cs.probe = { width: w, height: h, at: '' };
    }
    cs.status = s.v === 'reachable' || s.v === 'playback_confirmed' ? 'online' : s.v === 'temporarily_unavailable' || s.v === 'playback_failed' ? 'offline' : 'unknown';
    return cs;
  });
  // Only streams the TV can attempt are offered for playback; others stay visible as "unavailable".
  const playableStreams = streams.filter((_, idx) => c.st[idx]!.s === 'imported' || c.st[idx]!.s === 'duplicate_reference');
  const ch: LibChannel = {
    id: c.i,
    name: c.n,
    streams: playableStreams.length ? playableStreams : [],
    sources: c.r,
    playable: c.p === 1,
    repos: c.r,
    radio: c.k === 'r',
    validation: c.st[0] ? c.st[0].v : 'untested',
    // Exports made before membership flags existed: fall back to categories and sport tags.
    inNews: c.t ? c.t.indexOf('n') >= 0 : has(c.g, 'news'),
    inSports: c.t ? c.t.indexOf('s') >= 0 : !!(c.sp && c.sp.length) || has(c.g, 'sports'),
  };
  if (!ch.playable && c.st[0]) ch.reason = c.st[0].s;
  if (c.a) ch.altNames = c.a;
  if (c.c) ch.country = c.c;
  if (c.l) ch.languages = c.l;
  if (c.g) ch.categories = c.g;
  if (c.o) ch.logo = c.o;
  if (c.e) ch.epgId = c.e;
  if (c.sp) ch.sports = c.sp;
  if (c.f) ch.football = c.f;
  if (c.pay) ch.payTvBrand = true;
  return ch;
}

export async function loadLibrary(): Promise<void> {
  const server = libraryServer();
  const bases = server ? [server.replace(/\/registry\.json$/, '').replace(/\/?$/, '/'), 'library/'] : ['library/'];
  for (const base of bases) {
    try {
      const registry = await getJSON<LibRegistry>(`${base}registry.json`, { timeoutMs: 8000 });
      if (registry && registry.schema === 1 && Array.isArray(registry.items)) {
        library.value = { status: 'ready', registry, origin: base === 'library/' ? 'bundled' : 'server', base };
        console.info(`[fbtv] library ${base} ${registry.items.length} items (${registry.generatedAt})`);
        return;
      }
    } catch (err) {
      console.warn(`[fbtv] library not available at ${base}`, err);
    }
  }
  library.value = {
    status: 'missing',
    reason: server
      ? `The library server at ${server} did not answer and no library is bundled in this build.`
      : 'No source library in this build (public builds never include one). On the PC run "npm run library:refresh", then "npm run package -- --with-library", or "npm run library:serve" and enter its address in Settings › Sources.',
  };
}

export async function loadShard(name: string): Promise<LibChannel[]> {
  const hit = shardCache.get(name);
  if (hit) return hit;
  const s = library.value;
  if (s.status !== 'ready') return [];
  const info = s.registry.shards[name];
  if (!info) return [];
  const list = (await getJSON<CompactChannel[]>(`${s.base}${info.file}`, { timeoutMs: 60000, maxBytes: 80 * 1024 * 1024 })).map(adapt);
  shardCache.set(name, list);
  return list;
}

export async function loadCatalog<T>(file: string): Promise<T | null> {
  if (catalogCache.has(file)) return catalogCache.get(file) as T;
  const s = library.value;
  if (s.status !== 'ready') return null;
  try {
    const data = await getJSON<T>(`${s.base}${file}`, { timeoutMs: 30000, maxBytes: 40 * 1024 * 1024 });
    catalogCache.set(file, data);
    return data;
  } catch (err) {
    console.warn(`[fbtv] library catalog ${file} failed`, err);
    return null;
  }
}


/** Applies a registry item's selection rule to channels. Pure. */
export function applySelect(list: LibChannel[], sel: Record<string, string> | undefined): LibChannel[] {
  if (!sel) return list;
  return list.filter((c) => {
    for (const k of Object.keys(sel)) {
      const v = sel[k]!;
      switch (k) {
        case 'kind':
          if (v === 'radio' ? !c.radio : c.radio) return false;
          break;
        case 'country':
          if (v === 'unknown' ? !!c.country : (c.country || '').toLowerCase() !== v) return false;
          break;
        case 'language':
          if (v === 'unknown' ? !!(c.languages && c.languages.length) : v === 'not-eng-ara' ? has(c.languages, 'eng') || has(c.languages, 'ara') : !has(c.languages, v)) return false;
          break;
        case 'category':
          if (v === 'uncategorised' ? !!(c.categories && c.categories.length) : !has(c.categories, v)) return false;
          break;
        case 'source':
          if (c.repos.indexOf(v) < 0) return false;
          break;
        case 'sport':
          if (v === 'any' ? !c.inSports : v === 'general' ? !c.inSports || !!(c.sports && c.sports.length) : !has(c.sports, v)) return false;
          break;
        case 'football':
          if (v === 'any' ? !c.football && !has(c.sports, 'football') : c.football !== v) return false;
          break;
        case 'news':
          if (!c.inNews) return false;
          break;
        case 'validation':
          if (v === 'reachable' ? c.validation !== 'reachable' && c.validation !== 'playback_confirmed' : c.validation !== v) return false;
          break;
      }
    }
    return true;
  });
}

/** Channels for a registry item, from the shards it may draw on. */
export async function channelsForItem(item: LibItem, includeSecondary: boolean): Promise<LibChannel[]> {
  const primary = await loadShard('primary');
  const src = item.select && item.select.source;
  // Profiles and the curated sources are in the primary shard; other sources only in the secondary one.
  const secondary = includeSecondary || (src && ['iptv-org', 'free-tv'].indexOf(src) < 0 && src.indexOf('profile:') !== 0) ? await loadShard('secondary') : [];
  return applySelect(primary.concat(secondary), item.select);
}

export const preferredItem = signal<string>(readJSON<string>('library:item', 'country-uk'));
export function setPreferredItem(id: string): void {
  preferredItem.value = id;
  writeJSON('library:item', id);
}

/** Settings › Sources: also load channels found only in unreviewed / mixed-provenance lists. */
export const includeUnreviewed = signal<boolean>(readJSON<boolean>('library:secondary', false));
export function setIncludeUnreviewed(v: boolean): void {
  includeUnreviewed.value = v;
  writeJSON('library:secondary', v);
}
