/**
 * The Playlists section's data: every source playlist (one per file in each collection, built on
 * the PC), your selection, saved selection and named custom playlists.
 *
 * Playlists are loaded one at a time when opened or combined (never the whole library). Your
 * selections live on the TV and, when the TV reads the library from the PC's server, are saved to
 * settings/playlists.json there too, so they survive refreshes and reinstalls. Member ids are
 * stable ("src:<id>" for a source playlist, "lib:<id>" for an FBTV list).
 */
import { signal } from '@preact/signals';
import type { CatalogueChannel, CatalogueStream } from '../../shared/model.ts';
import { getJSON, putJSON } from './http.ts';
import { channelsForItem, library, type LibItem } from './sourceLibrary.ts';
import { readJSON, writeJSON } from '../platform/storage.ts';

export type EntryState = 'ok' | 'unsupported' | 'lan' | 'withheld' | 'malformed' | 'test' | 'website' | 'no-url';

export interface PlaylistEntry {
  n: string;
  g?: string;
  o?: string;
  c?: string;
  l?: string[];
  k?: string;
  u?: string[];
  s: EntryState;
  v?: string;
  why?: string;
  vod?: 1;
  sr?: string;
  line: number;
}

export interface SourcePlaylist {
  id: string;
  collection: string;
  repo: string;
  file: string;
  title: string;
  origin: string;
  entries: number;
  channels: number;
  playable: number;
  duplicates: number;
  withheld: number;
  unsupported: number;
  malformed: number;
  other: number;
  vod: number;
  validation: { confirmed: number; recognised: number; reachable: number; unavailable: number; failed: number; untested: number };
  groups: number;
}

export interface Collection {
  id: string;
  name: string;
  url?: string;
  note?: string;
  supplied: boolean;
  playlists: string[];
}

export interface PlaylistIndex {
  schema: 1;
  generatedAt: string;
  collections: Collection[];
  playlists: SourcePlaylist[];
}

export interface CustomPlaylist {
  id: string;
  name: string;
  members: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistSettings {
  version: 1;
  updatedAt: string;
  selected: string[];
  saved?: { selected: string[]; savedAt: string } | null;
  custom: CustomPlaylist[];
}

export type IndexState = { status: 'loading' } | { status: 'missing'; reason: string } | { status: 'ready'; index: PlaylistIndex; byId: Map<string, SourcePlaylist> };

export const playlistIndex = signal<IndexState>({ status: 'loading' });

const STATE_KEY = 'playlists:state';
const empty = (): PlaylistSettings => ({ version: 1, updatedAt: '', selected: [], saved: null, custom: [] });
export const playlistState = signal<PlaylistSettings>({ ...empty(), ...readJSON<Partial<PlaylistSettings>>(STATE_KEY, {}) });
/** Where the last save went: 'pc' when the library server accepted it. */
export const syncStatus = signal<'local' | 'pc' | 'pc-failed'>('local');

const base = () => (library.value.status === 'ready' ? library.value.base : 'library/');
const onServer = () => library.value.status === 'ready' && library.value.origin === 'server';

/** Library base the index was loaded from (it reloads when the TV switches to or from the PC). */
export let indexBase = '';

export async function loadPlaylistIndex(): Promise<void> {
  if (library.value.status !== 'ready') return;
  indexBase = library.value.base;
  cache.clear();
  try {
    const index = await getJSON<PlaylistIndex>(`${base()}playlists/index.json`, { timeoutMs: 20000, maxBytes: 20 * 1024 * 1024 });
    playlistIndex.value = { status: 'ready', index, byId: new Map(index.playlists.map((p) => [p.id, p])) };
  } catch (err) {
    playlistIndex.value = { status: 'missing', reason: `No playlists in this library (${(err as Error).message}). Run "npm run library:rebuild" on the PC.` };
  }
  await pullSettings();
}

// ------------------------------------------------------------------ settings and sync

function commit(next: PlaylistSettings): void {
  const s = { ...next, updatedAt: new Date().toISOString() };
  playlistState.value = s;
  writeJSON(STATE_KEY, s);
  pushSoon();
}

let pushTimer: ReturnType<typeof setTimeout> | null = null;
function pushSoon(): void {
  if (!onServer()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    putJSON(`${base()}settings/playlists.json`, playlistState.value).then(
      () => (syncStatus.value = 'pc'),
      () => (syncStatus.value = 'pc-failed'),
    );
  }, 800);
}

/** Takes the PC's copy when it is newer (e.g. after reinstalling the app). */
export async function pullSettings(): Promise<void> {
  if (!onServer()) return;
  try {
    const remote = await getJSON<PlaylistSettings>(`${base()}settings/playlists.json`, { timeoutMs: 6000 });
    const local = playlistState.value;
    if (remote && remote.version === 1 && (remote.updatedAt || '') > (local.updatedAt || '')) {
      playlistState.value = remote;
      writeJSON(STATE_KEY, remote);
    } else if ((local.updatedAt || '') > (remote.updatedAt || '')) pushSoon();
    syncStatus.value = 'pc';
  } catch {
    syncStatus.value = 'pc-failed';
  }
}

// ------------------------------------------------------------------ operations (pure helpers + commits)

export const isSelected = (id: string) => playlistState.value.selected.indexOf(id) >= 0;

export function toggleSelected(id: string): boolean {
  const s = playlistState.value;
  const on = s.selected.indexOf(id) < 0;
  commit({ ...s, selected: on ? s.selected.concat([id]) : s.selected.filter((x) => x !== id) });
  return on;
}

export function selectAll(ids: string[]): void {
  const s = playlistState.value;
  const add = ids.filter((id) => s.selected.indexOf(id) < 0);
  commit({ ...s, selected: s.selected.concat(add) });
}

export function clearAll(ids: string[]): void {
  const s = playlistState.value;
  commit({ ...s, selected: s.selected.filter((x) => ids.indexOf(x) < 0) });
}

export function saveSelection(): void {
  const s = playlistState.value;
  commit({ ...s, saved: { selected: s.selected.slice(), savedAt: new Date().toISOString() } });
}

export function restoreSelection(): boolean {
  const s = playlistState.value;
  if (!s.saved) return false;
  commit({ ...s, selected: s.saved.selected.slice() });
  return true;
}

export function createCustom(name: string, members: string[]): CustomPlaylist {
  const now = new Date().toISOString();
  const c: CustomPlaylist = { id: `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`, name: name.trim().slice(0, 120), members: dedupe(members), createdAt: now, updatedAt: now };
  const s = playlistState.value;
  commit({ ...s, custom: s.custom.concat([c]) });
  return c;
}

export function renameCustom(id: string, name: string): void {
  const s = playlistState.value;
  commit({ ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, name: name.trim().slice(0, 120), updatedAt: new Date().toISOString() } : c)) });
}

export function addToCustom(id: string, members: string[]): void {
  const s = playlistState.value;
  commit({ ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, members: dedupe(c.members.concat(members)), updatedAt: new Date().toISOString() } : c)) });
}

export function removeFromCustom(id: string, member: string): void {
  const s = playlistState.value;
  commit({ ...s, custom: s.custom.map((c) => (c.id === id ? { ...c, members: c.members.filter((m) => m !== member), updatedAt: new Date().toISOString() } : c)) });
}

export function deleteCustom(id: string): void {
  const s = playlistState.value;
  commit({ ...s, custom: s.custom.filter((c) => c.id !== id), selected: s.selected.filter((x) => x !== `custom:${id}`) });
}

function dedupe(a: string[]): string[] {
  return a.filter((x, i) => a.indexOf(x) === i);
}

// ------------------------------------------------------------------ entries

const cache = new Map<string, PlaylistEntry[]>();

export async function loadEntries(member: string): Promise<PlaylistEntry[]> {
  const hit = cache.get(member);
  if (hit) return hit;
  let list: PlaylistEntry[] = [];
  if (member.indexOf('src:') === 0) {
    const d = await getJSON<{ entries: PlaylistEntry[] }>(`${base()}playlists/${member.slice(4)}.json`, { timeoutMs: 30000, maxBytes: 40 * 1024 * 1024 });
    list = d.entries || [];
  } else if (member.indexOf('lib:') === 0 && library.value.status === 'ready') {
    const item = library.value.registry.items.filter((i) => i.id === member.slice(4))[0] as LibItem | undefined;
    if (item && item.select) {
      const channels = await channelsForItem(item, true);
      list = channels.map((c, i) => ({ n: c.name, o: c.logo, c: c.country, l: c.languages, k: c.id, g: c.categories && c.categories[0], u: c.streams.map((s) => s.url), s: c.playable ? 'ok' : 'unsupported', line: i + 1 }));
    }
  } else if (member.indexOf('custom:') === 0) {
    const c = playlistState.value.custom.filter((x) => x.id === member.slice(7))[0];
    list = c ? await combine(c.members.filter((m) => m.indexOf('custom:') !== 0)) : [];
    return list;
  }
  if (cache.size > 12) cache.delete(cache.keys().next().value as string);
  cache.set(member, list);
  return list;
}

/** Merges entries: the same channel (key, else first URL) once, with every URL as an alternative. Pure. */
export function mergeEntries(lists: PlaylistEntry[][]): PlaylistEntry[] {
  const out: PlaylistEntry[] = [];
  const byKey = new Map<string, PlaylistEntry>();
  for (const list of lists)
    for (const e of list) {
      if (e.s !== 'ok' || !e.u || !e.u.length) {
        out.push(e);
        continue;
      }
      const key = e.k || `u:${e.u[0]}`;
      const prev = byKey.get(key);
      if (prev) {
        for (const u of e.u) if (prev.u!.indexOf(u) < 0) prev.u!.push(u);
        continue;
      }
      const copy = { ...e, u: e.u.slice() };
      byKey.set(key, copy);
      out.push(copy);
    }
  return out;
}

export async function combine(members: string[]): Promise<PlaylistEntry[]> {
  const lists: PlaylistEntry[][] = [];
  for (const m of members) {
    try {
      lists.push(await loadEntries(m));
    } catch {
      // a missing member is shown as missing; the rest still combine
    }
  }
  return mergeEntries(lists);
}

/** Private entries resolve through the library server; without it they cannot play. */
export function resolveUrl(u: string): string | null {
  if (u.charAt(0) !== '@') return u;
  return onServer() ? `${base()}${u.slice(1)}` : null;
}

const STATE_TEXT: Record<EntryState, string> = {
  ok: '',
  unsupported: 'Format or protocol the TV cannot play',
  lan: 'Only reachable inside its own network',
  withheld: 'Link withheld',
  malformed: 'Malformed line in the source',
  test: 'Test entry',
  website: 'Website, not a video stream',
  'no-url': 'No stream address in the source',
};

export function entryProblem(e: PlaylistEntry): string {
  if (e.s === 'ok') {
    const urls = (e.u || []).map(resolveUrl);
    if (!urls.some(Boolean)) return 'Plays only when the TV reads the library from your PC (Settings › Sources)';
    return '';
  }
  return e.why || STATE_TEXT[e.s];
}

const VALID_TEXT: Record<string, string> = {
  playback_confirmed: 'Playback confirmed',
  format_recognised: 'Format recognised',
  reachable: 'URL reachable',
  temporarily_unavailable: 'Temporarily unavailable',
  playback_failed: 'Playback failed at last check',
};
export const validationText = (v?: string) => (v ? VALID_TEXT[v] || v : 'Not yet checked');

/** Playable entries as channels for the player (alternatives become fallback streams). Pure. */
export function entriesToChannels(entries: PlaylistEntry[], scope: string): CatalogueChannel[] {
  const out: CatalogueChannel[] = [];
  entries.forEach((e, i) => {
    if (e.s !== 'ok' || !e.u) return;
    const streams: CatalogueStream[] = [];
    e.u.forEach((u, j) => {
      const url = resolveUrl(u);
      if (url) streams.push({ id: `${scope}:${i}#${j}`, url, source: scope });
    });
    if (!streams.length) return;
    const c: CatalogueChannel = { id: `pl:${e.k || e.u[0]}`, name: e.n, streams, sources: [scope] };
    if (e.o) c.logo = e.o;
    if (e.c) c.country = e.c;
    if (e.l) c.languages = e.l;
    if (e.vod) c.playback = { resumeKey: `pl:${e.u[0]}` };
    out.push(c);
  });
  return out;
}

export function memberTitle(m: string): string {
  const s = playlistIndex.value;
  if (m.indexOf('src:') === 0 && s.status === 'ready') {
    const p = s.byId.get(m.slice(4));
    return p ? p.title : 'Missing playlist';
  }
  if (m.indexOf('lib:') === 0 && library.value.status === 'ready') {
    const item = library.value.registry.items.filter((i) => i.id === m.slice(4))[0];
    return item ? `FBTV · ${item.name}` : 'Missing list';
  }
  if (m.indexOf('custom:') === 0) {
    const c = playlistState.value.custom.filter((x) => x.id === m.slice(7))[0];
    return c ? c.name : 'Missing playlist';
  }
  return m;
}
