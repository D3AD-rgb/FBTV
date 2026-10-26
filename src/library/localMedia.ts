/**
 * Your own media files: FBTV-local-data/media/{movies,series,other}. Indexed on the PC and played
 * on the TV through the library server (GET /media/<id>, with byte ranges for seeking). The TV
 * only ever sees ids, titles and subtitle/artwork ids, never file paths.
 *
 * Recognised layouts:
 *   media/movies/Some Film (1959).mp4            title + year from the name
 *   media/series/Show Name/Season 1/S01E02.mkv   series from the folder, season/episode from names
 *   media/series/Show.Name.S02E05.mp4             series and SxxEyy from the file name
 *   sidecar subtitles: Film.srt, Film.en.srt, Film.vtt   artwork: poster.jpg / folder.jpg / Film.jpg
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative } from 'node:path';
import { trackOutput } from './outputs.ts';

export const VIDEO_EXT = ['.mp4', '.m4v', '.mkv', '.webm', '.mov', '.avi', '.ts', '.m2ts', '.mpg', '.mpeg', '.wmv', '.flv'];
const SUB_EXT = ['.srt', '.vtt'];
const ART_NAMES = ['poster', 'folder', 'cover'];

export interface LocalSubtitle {
  id: number;
  label: string;
  language?: string;
  /** PC only */
  path?: string;
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
  /** PC only (never exported) */
  path?: string;
  artPath?: string;
}

export function mediaId(rel: string): string {
  return createHash('sha1').update(rel.split('\\').join('/').toLowerCase()).digest('hex').slice(0, 16);
}

const clean = (s: string) => s.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Title, year, series, season and episode from a path relative to media/. Pure. */
export function parseMediaName(rel: string): Pick<LocalItem, 'kind' | 'title' | 'year' | 'series' | 'season' | 'episode'> {
  const parts = rel.split(/[\\/]/);
  const top = (parts[0] || '').toLowerCase();
  const file = basename(rel, extname(rel));
  const se = /\bS(\d{1,2})\s*E(\d{1,3})\b/i.exec(file) || /\b(\d{1,2})x(\d{2,3})\b/.exec(file);
  if (top === 'series' || se) {
    const folder = parts.length > 2 ? parts[1]! : '';
    const seasonFolder = parts.length > 3 ? /season\s*(\d+)/i.exec(parts[2]!) : null;
    let series = folder ? clean(folder) : '';
    if (!series && se) series = clean(file.slice(0, se.index)).replace(/[-\s]+$/, '');
    const season = se ? Number(se[1]) : seasonFolder ? Number(seasonFolder[1]) : undefined;
    const epNum = se ? Number(se[2]) : (/\b(?:e|ep|episode)\s*(\d{1,3})\b/i.exec(file) || [])[1];
    const after = se ? clean(file.slice(se.index + se[0].length)).replace(/^[-\s]+/, '') : clean(file);
    return { kind: 'episode', title: after || `Episode ${epNum || ''}`.trim(), series: series || 'Unsorted', season, episode: epNum !== undefined ? Number(epNum) : undefined };
  }
  const y = /[\s(.[_-]((?:19|20)\d{2})(?:[\s).\]_-]|$)/.exec(file);
  const title = clean(y ? file.slice(0, y.index) : file).replace(/[-(\s]+$/, '') || clean(file);
  return { kind: top === 'movies' ? 'movie' : 'other', title, year: y ? Number(y[1]) : undefined };
}

function walk(dir: string, out: string[]): void {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.charAt(0) === '.') continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
}

/** Scans media/ and returns the index (with paths, for the PC). */
export function scanLocalMedia(dataDir: string): LocalItem[] {
  const root = join(dataDir, 'media');
  for (const d of ['movies', 'series', 'other']) mkdirSync(join(root, d), { recursive: true });
  const files: string[] = [];
  walk(root, files);
  const items: LocalItem[] = [];
  for (const abs of files) {
    const ext = extname(abs).toLowerCase();
    if (VIDEO_EXT.indexOf(ext) < 0) continue;
    const rel = relative(root, abs);
    const st = statSync(abs);
    const base = basename(abs, extname(abs));
    const dir = dirname(abs);
    const siblings = readdirSync(dir);
    const subtitles: LocalSubtitle[] = siblings
      .filter((n) => SUB_EXT.indexOf(extname(n).toLowerCase()) >= 0 && n.toLowerCase().indexOf(base.toLowerCase()) === 0)
      .map((n, i) => {
        const tag = n.slice(base.length, n.length - extname(n).length).replace(/^[._-]/, '');
        return { id: i, label: tag ? tag.toUpperCase() : 'Subtitles', language: tag || undefined, path: join(dir, n) };
      });
    const art = siblings.filter((n) => /\.(jpe?g|png)$/i.test(n) && (n.toLowerCase().indexOf(base.toLowerCase() + '.') === 0 || ART_NAMES.indexOf(basename(n, extname(n)).toLowerCase()) >= 0))[0];
    const item: LocalItem = {
      id: mediaId(rel),
      ...parseMediaName(rel),
      ext: ext.slice(1),
      size: st.size,
      modified: st.mtime.toISOString(),
      subtitles,
      path: abs,
    };
    if (art) {
      item.art = true;
      item.artPath = join(dir, art);
    }
    items.push(item);
  }
  items.sort((a, b) => (a.series || a.title).localeCompare(b.series || b.title) || (a.season || 0) - (b.season || 0) || (a.episode || 0) - (b.episode || 0) || a.title.localeCompare(b.title));
  return items;
}

/** Strips paths for the TV. Pure. */
export function publicMedia(items: LocalItem[]): LocalItem[] {
  return items.map((i) => {
    const o: LocalItem = { ...i, subtitles: i.subtitles.map((s) => ({ id: s.id, label: s.label, language: s.language })) };
    delete o.path;
    delete o.artPath;
    return o;
  });
}

export function writeLocalMedia(dataDir: string, exportDir: string, items: LocalItem[]): void {
  const pc = join(dataDir, 'catalogs', 'local-media.json');
  writeFileSync(pc, JSON.stringify({ generatedAt: new Date().toISOString(), items }));
  trackOutput(pc);
  writeFileSync(join(exportDir, 'local-media.json'), JSON.stringify({ generatedAt: new Date().toISOString(), items: publicMedia(items) }));
}

/** SubRip to WebVTT (the TV's <track> needs VTT). Pure. */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/^\d+\n(?=\d{2}:\d{2}:\d{2}\.\d{3} -->)/gm, '');
  return `WEBVTT\n\n${body.trim()}\n`;
}
