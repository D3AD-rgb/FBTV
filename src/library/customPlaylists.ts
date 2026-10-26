/**
 * Your named playlists and your current selection, as defined on the TV (Playlists section) and
 * saved to settings/playlists.json through the library server. Each one is rebuilt as an M3U in
 * playlists/custom/ from its members' current entries, so refreshing a source never loses a
 * selection: members are stable ids ("src:<playlist id>" or "lib:<FBTV list id>"), and a member
 * that no longer exists is reported, not dropped from your definition.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Registry } from './catalogs.ts';
import type { PlaylistSettings } from './export.ts';
import { writeOutput } from './outputs.ts';
import { playlistM3U, type SourcePlaylistsResult } from './sourcePlaylists.ts';

/** EXTINF + URL pairs of an M3U text, in order. Pure. */
export function m3uPairs(text: string): [string, string][] {
  const out: [string, string][] = [];
  let info = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.indexOf('#EXTINF') === 0) info = line;
    else if (line.charAt(0) !== '#' && info) {
      out.push([info, line]);
      info = '';
    }
  }
  return out;
}

/** Merges member playlists into one M3U, dropping repeated URLs (each address once). Pure. */
export function mergeM3U(title: string, members: string[]): string {
  const seen = new Set<string>();
  const out = ['#EXTM3U', `#PLAYLIST:${title.replace(/[\r\n]+/g, ' ')}`];
  for (const text of members)
    for (const [info, url] of m3uPairs(text)) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(info, url);
    }
  return out.join('\n') + '\n';
}

const slug = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playlist';

export interface CustomResult {
  name: string;
  file: string;
  members: number;
  missing: string[];
}

export function writeCustomPlaylists(dir: string, sp: SourcePlaylistsResult, registry: Registry, settings: PlaylistSettings | null): CustomResult[] {
  if (!settings) return [];
  const byId = new Map(sp.playlists.map((p) => [p.id, p]));
  const memberText = (m: string): string | null => {
    if (m.indexOf('src:') === 0) {
      const p = byId.get(m.slice(4));
      return p ? playlistM3U(p, sp.entries.get(p.id) || []) : null;
    }
    if (m.indexOf('lib:') === 0) {
      const item = registry.items.filter((i) => i.id === m.slice(4))[0];
      const path = item && item.path ? join(dir, item.path) : '';
      return path && existsSync(path) ? readFileSync(path, 'utf8') : null;
    }
    return null;
  };
  const results: CustomResult[] = [];
  const build = (name: string, members: string[], file: string) => {
    const texts: string[] = [];
    const missing: string[] = [];
    for (const m of members) {
      const t = memberText(m);
      if (t === null) missing.push(m);
      else texts.push(t);
    }
    writeOutput(join(dir, 'playlists', 'custom', file), mergeM3U(name, texts));
    results.push({ name, file: `playlists/custom/${file}`, members: members.length, missing });
  };
  if (settings.selected.length) build('My selection', settings.selected, 'my-selection.m3u');
  const used = new Set<string>();
  for (const c of settings.custom) {
    let file = `${slug(c.name)}.m3u`;
    if (used.has(file)) file = `${slug(c.name)}-${c.id.slice(-4)}.m3u`;
    used.add(file);
    build(c.name, c.members, file);
  }
  return results;
}
