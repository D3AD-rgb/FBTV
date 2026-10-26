/**
 * Source playlists: every playlist file each collection supplies, kept as its own playlist with
 * a stable id (hash of source + path), its original entries in their original order, group
 * titles and alternative URLs. Built from the inventory (which never alters the originals).
 *
 * Outputs:
 *  - playlists/source-playlists/<collection>/<file>.m3u  normalised M3U you can open in any player
 *  - TV export playlists/index.json + playlists/<id>.json   what the TV's Playlists section reads
 *
 * Entries keep their status. Withheld entries (paid-channel relays, hotel gateways, someone
 * else's account URLs) have no URL in the inventory and are listed by name and reason only.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InventoryRecord } from './inventory.ts';
import { trackOutput } from './outputs.ts';
import { isPrivateSource, privateRef } from './privateUrls.ts';

export interface CollectionDef {
  id: string;
  name: string;
  url?: string;
  /** Inventory repos whose files belong to this collection. */
  repos: (repo: string) => boolean;
  note?: string;
  /** One of the nine supplied repositories (shown first, in this order). */
  supplied?: boolean;
}

export const COLLECTIONS: CollectionDef[] = [
  { id: 'iptv-org', name: 'iptv-org/iptv', url: 'https://github.com/iptv-org/iptv', repos: (r) => r === 'iptv-org', supplied: true },
  {
    id: 'my-tv',
    name: 'lizongying/my-tv',
    url: 'https://github.com/lizongying/my-tv',
    repos: (r) => r === 'my-tv',
    supplied: true,
    note: 'An app channel list without stream addresses: its streams need the broadcaster’s signed tokens, so nothing here can play.',
  },
  { id: 'tvlist-awesome', name: 'imDazui/Tvlist-awesome-m3u-m3u8', url: 'https://github.com/imDazui/Tvlist-awesome-m3u-m3u8', repos: (r) => r === 'tvlist-awesome', supplied: true },
  { id: 'fanmingming-live', name: 'fanmingming/live', url: 'https://github.com/fanmingming/live', repos: (r) => r === 'fanmingming-live', supplied: true },
  { id: 'iptv-api', name: 'Guovin/iptv-api', url: 'https://github.com/Guovin/iptv-api', repos: (r) => r === 'iptv-api', supplied: true },
  {
    id: 'zhuiju-free',
    name: 'laoma528/awesome-zhuiju-free',
    url: 'https://github.com/laoma528/awesome-zhuiju-free',
    repos: (r) => r === 'zhuiju-free',
    supplied: true,
    note: 'A list of websites and apps, not video streams.',
  },
  {
    id: 'awesome-iptv',
    name: 'iptv-org/awesome-iptv (with Free-TV)',
    url: 'https://github.com/iptv-org/awesome-iptv',
    repos: (r) => r === 'awesome-iptv' || r === 'free-tv',
    supplied: true,
    note: 'An index of IPTV resources; its playable list is Free-TV/IPTV, which it links to.',
  },
  { id: 'iptv-sources', name: 'HerbertHe/iptv-sources', url: 'https://github.com/HerbertHe/iptv-sources', repos: (r) => r === 'iptv-sources', supplied: true },
  {
    id: 'iptvnator',
    name: '4gray/iptvnator',
    url: 'https://github.com/4gray/iptvnator',
    repos: (r) => r === 'iptvnator',
    supplied: true,
    note: 'An IPTV player; its only playlists are test files.',
  },
  { id: 'my-playlist', name: 'My Playlist', repos: (r) => r.indexOf('profile:') === 0, note: 'Your own playlists from provider-profiles/profiles.local.json.' },
  { id: 'jromero88', name: 'jromero88/iptv', url: 'https://github.com/jromero88/iptv', repos: (r) => r === 'jromero88' },
  { id: 'internet-archive', name: 'Internet Archive (public domain)', url: 'https://archive.org', repos: (r) => r === 'internet-archive' },
];

/** Entry status as the TV shows it. */
export type EntryState = 'ok' | 'unsupported' | 'lan' | 'withheld' | 'malformed' | 'test' | 'website' | 'no-url';

export interface PlaylistEntry {
  /** name */
  n: string;
  /** original group title */
  g?: string;
  o?: string;
  c?: string;
  l?: string[];
  /** channel key (same channel across playlists) */
  k?: string;
  /** stream URLs: the first is preferred, the rest are alternatives */
  u?: string[];
  s: EntryState;
  /** validation of the first URL */
  v?: string;
  /** reason when not playable */
  why?: string;
  /** on demand */
  vod?: 1;
  /** episode grouping (series) */
  sr?: string;
  /** original line in the source file */
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

/** Stable across refreshes: depends only on the source and the file's path. Pure. */
export function playlistId(repo: string, file: string): string {
  return createHash('sha1').update(`${repo}|${file}`).digest('hex').slice(0, 12);
}

const PLAYLIST_KINDS = new Set(['stream', 'radio', 'vod', 'channel-without-url', 'website', 'malformed-line']);

function stateOf(r: InventoryRecord): EntryState {
  if (r.kind === 'malformed-line' || r.status === 'malformed') return 'malformed';
  if (r.kind === 'website') return 'website';
  if (r.status === 'test_fixture') return 'test';
  if (r.status === 'restricted') return 'withheld';
  if (r.status === 'unsupported_format') return 'unsupported';
  if (r.status === 'requires_provider_access') return r.url ? 'lan' : 'no-url';
  if (r.kind === 'channel-without-url' || !r.url) return 'no-url';
  return 'ok';
}

function titleOf(repo: string, file: string): string {
  if (repo.indexOf('profile:') === 0) return repo.slice(8);
  if (repo === 'internet-archive') return { 'films-eng': 'English films', 'tv-eng': 'Classic TV series', 'films-hin': 'Hindi films', 'films-ben': 'Bengali films' }[file] || file;
  let t = file;
  try {
    t = decodeURIComponent(file);
  } catch {
    // keep as is
  }
  return t.replace(/^https?:\/\/(raw\.githubusercontent\.com\/)?/i, '').replace(/^iptv-org\.github\.io\/iptv\//, '');
}

export interface SourcePlaylistsResult {
  collections: { id: string; name: string; url?: string; note?: string; supplied: boolean; playlists: string[] }[];
  playlists: SourcePlaylist[];
  entries: Map<string, PlaylistEntry[]>;
}

/** Groups inventory records into one playlist per source file, merging duplicate channels. Pure. */
export function discoverSourcePlaylists(records: InventoryRecord[], profileNames: Record<string, string> = {}): SourcePlaylistsResult {
  const byFile = new Map<string, InventoryRecord[]>();
  for (const r of records) {
    if (!PLAYLIST_KINDS.has(r.kind)) continue;
    const key = `${r.source.repo}\u0000${r.source.file}`;
    const a = byFile.get(key);
    if (a) a.push(r);
    else byFile.set(key, [r]);
  }
  const playlists: SourcePlaylist[] = [];
  const entries = new Map<string, PlaylistEntry[]>();
  for (const [key, recs] of byFile) {
    const [repo, file] = key.split('\u0000') as [string, string];
    const col = COLLECTIONS.filter((c) => c.repos(repo))[0];
    if (!col) continue;
    recs.sort((a, b) => a.source.line - b.source.line);
    const id = playlistId(repo, file);
    const list: PlaylistEntry[] = [];
    const byChannel = new Map<string, PlaylistEntry>();
    let duplicates = 0;
    const groups = new Set<string>();
    for (const r of recs) {
      const s = stateOf(r);
      if (r.meta.group) groups.add(r.meta.group);
      if (s === 'ok' && r.url) {
        const k = r.channelKey || `u:${r.url}`;
        const prev = byChannel.get(k);
        if (prev) {
          // Same channel again: keep every distinct URL as an alternative.
          if (prev.u!.indexOf(r.url) < 0) prev.u!.push(r.url);
          duplicates++;
          continue;
        }
        const e: PlaylistEntry = { n: r.name, s, u: [r.url], line: r.source.line };
        if (r.meta.group) e.g = r.meta.group;
        if (r.meta.logo) e.o = r.meta.logo;
        if (r.meta.country) e.c = r.meta.country;
        if (r.meta.languages.length) e.l = r.meta.languages;
        if (r.channelKey) e.k = r.channelKey;
        if (r.validation && r.validation !== 'untested') e.v = r.validation;
        if (r.kind === 'vod') e.vod = 1;
        const series = r.meta.extra && (r.meta.extra.series as string | undefined);
        if (series) e.sr = series;
        byChannel.set(k, e);
        list.push(e);
      } else {
        const e: PlaylistEntry = { n: r.name || '(no name)', s, line: r.source.line };
        if (r.meta.group) e.g = r.meta.group;
        if (r.url && (s === 'unsupported' || s === 'lan' || s === 'test')) e.u = [r.url];
        if (r.reasons[0]) e.why = r.reasons[0];
        if (r.kind === 'vod') e.vod = 1;
        list.push(e);
      }
    }
    const count = (st: EntryState) => list.filter((e) => e.s === st).length;
    const ok = list.filter((e) => e.s === 'ok');
    const val = (v: string) => ok.filter((e) => e.v === v).length;
    playlists.push({
      id,
      collection: col.id,
      repo,
      file,
      title: repo.indexOf('profile:') === 0 ? profileNames[repo.slice(8)] || titleOf(repo, file) : titleOf(repo, file),
      // Your own sources: no URL or local path leaves the PC.
      origin: isPrivateSource(repo) ? '' : recs[0]!.source.originUrl || '',
      entries: recs.length,
      channels: list.length,
      playable: ok.length,
      duplicates,
      withheld: count('withheld'),
      unsupported: count('unsupported') + count('lan'),
      malformed: count('malformed'),
      other: count('test') + count('website') + count('no-url'),
      vod: list.filter((e) => e.vod).length,
      validation: {
        confirmed: val('playback_confirmed'),
        recognised: val('format_recognised'),
        reachable: val('reachable'),
        unavailable: val('temporarily_unavailable'),
        failed: val('playback_failed'),
        untested: ok.filter((e) => !e.v).length,
      },
      groups: groups.size,
    });
    entries.set(id, list);
  }
  playlists.sort((a, b) => a.collection.localeCompare(b.collection) || a.title.localeCompare(b.title));
  const collections = COLLECTIONS.map((c) => ({
    id: c.id,
    name: c.name,
    url: c.url,
    note: c.note,
    supplied: !!c.supplied,
    playlists: playlists.filter((p) => p.collection === c.id).map((p) => p.id),
  }));
  return { collections, playlists, entries };
}

const attr = (s: string) => s.replace(/"/g, "'").replace(/[\r\n]+/g, ' ');

/** One normalised M3U per source playlist: every URL (alternatives included), withheld entries as comments. Pure. */
export function playlistM3U(p: SourcePlaylist, list: PlaylistEntry[]): string {
  const out = ['#EXTM3U', `#PLAYLIST:${attr(p.title)}`, `# Source: ${p.origin || p.file} (${p.collection}); generated by FBTV from the original file, which is kept unchanged.`];
  for (const e of list) {
    if (!e.u || !e.u.length) {
      out.push(`# ${e.s}: ${attr(e.n)}${e.why ? ` — ${attr(e.why)}` : ''} (line ${e.line})`);
      continue;
    }
    const attrs = [e.k && e.k.indexOf('n:') !== 0 ? `tvg-id="${attr(e.k)}"` : '', `tvg-name="${attr(e.n)}"`, e.o ? `tvg-logo="${attr(e.o)}"` : '', e.c ? `tvg-country="${attr(e.c)}"` : '', e.l ? `tvg-language="${e.l.join(';')}"` : '', e.g ? `group-title="${attr(e.g)}"` : '']
      .filter(Boolean)
      .join(' ');
    for (const u of e.u) {
      out.push(`#EXTINF:-1 ${attrs},${attr(e.n)}`);
      out.push(u);
    }
  }
  return out.join('\n') + '\n';
}

function safeName(s: string): string {
  return s.replace(/^https?:\/\//, '').replace(/[\\/:*?"<>|#\s]+/g, '_').slice(-120) || 'playlist';
}

/** Writes the PC M3U copies and the TV files; returns the index written for the TV. */
export function writeSourcePlaylists(dataDir: string, exportDir: string, res: SourcePlaylistsResult): { files: number } {
  let files = 0;
  for (const p of res.playlists) {
    const list = res.entries.get(p.id) || [];
    const m3u = join(dataDir, 'playlists', 'source-playlists', p.collection, `${safeName(p.title.replace(/\.(m3u8?|txt)$/i, ''))}-${p.id.slice(0, 6)}.m3u`);
    mkdirSync(join(m3u, '..'), { recursive: true });
    writeFileSync(m3u, playlistM3U(p, list));
    trackOutput(m3u);
    const tv = join(exportDir, 'playlists', `${p.id}.json`);
    mkdirSync(join(tv, '..'), { recursive: true });
    const tvList = isPrivateSource(p.repo) ? list.map((e) => (e.u ? { ...e, u: e.u.map(privateRef) } : e)) : list;
    writeFileSync(tv, JSON.stringify({ id: p.id, title: p.title, collection: p.collection, entries: tvList }));
    files++;
  }
  const index = res.playlists.map((p) => (isPrivateSource(p.repo) ? { ...p, file: '', origin: '' } : p));
  writeFileSync(join(exportDir, 'playlists', 'index.json'), JSON.stringify({ schema: 1, generatedAt: new Date().toISOString(), collections: res.collections, playlists: index }));
  return { files };
}
