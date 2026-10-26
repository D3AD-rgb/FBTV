/**
 * Internet Archive: legal on-demand films and TV (Rule 7 substitute for unlicensed VOD sources).
 *
 * The search results (stored as originals by `collect`, see repos.ts) list items whose uploader
 * marked them Public Domain (Public Domain Mark / CC0). That mark is not proof: many recent
 * Hindi and Bengali "public domain" uploads are ripped commercial films (FND-022). An item is
 * only offered when its release year is old enough for the public domain, it carries no rip
 * tags, and undated items come from curated collections. Everything else is recorded with the
 * reason it was excluded.
 *
 * One metadata request per eligible item finds its playable H.264 MP4 files; responses are
 * cached for good (items rarely change).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { USER_AGENT } from '../builder/fetch.ts';

export interface ArchiveSet {
  id: string;
  /** Path of the stored search response under repositories/internet-archive/. */
  file: string;
  query: string;
  rows: number;
  kind: 'films' | 'tv';
  language: 'eng' | 'hin' | 'ben';
  /** Latest release year accepted as public domain for this set. */
  maxYear: number;
  /** Items resolved per refresh (most downloaded first). */
  cap: number;
}

const FIELDS = ['identifier', 'title', 'year', 'date', 'language', 'licenseurl', 'downloads', 'runtime', 'collection', 'subject'];

export function searchUrl(query: string, rows: number): string {
  const p = [`q=${encodeURIComponent(query)}`, ...FIELDS.map((f) => `fl[]=${f}`), 'sort[]=downloads+desc', `rows=${rows}`, 'page=1', 'output=json'];
  return `https://archive.org/advancedsearch.php?${p.join('&')}`;
}

export const ARCHIVE_SETS: ArchiveSet[] = [
  { id: 'films-eng', file: 'search/films-eng.json', query: 'collection:feature_films AND licenseurl:*publicdomain*', rows: 8000, kind: 'films', language: 'eng', maxYear: 1977, cap: 2500 },
  { id: 'tv-eng', file: 'search/tv-eng.json', query: 'collection:classic_tv AND licenseurl:*publicdomain*', rows: 2500, kind: 'tv', language: 'eng', maxYear: 1977, cap: 900 },
  { id: 'films-hin', file: 'search/films-hin.json', query: 'mediatype:movies AND licenseurl:*publicdomain* AND (language:Hindi OR language:hin)', rows: 2000, kind: 'films', language: 'hin', maxYear: 1965, cap: 800 },
  { id: 'films-ben', file: 'search/films-ben.json', query: 'mediatype:movies AND licenseurl:*publicdomain* AND (language:Bengali OR language:ben OR language:Bangla)', rows: 600, kind: 'films', language: 'ben', maxYear: 1965, cap: 400 },
];

interface SearchDoc {
  identifier: string;
  title?: string | string[];
  year?: string | number;
  date?: string;
  language?: string | string[];
  licenseurl?: string;
  downloads?: number;
  runtime?: string;
  collection?: string | string[];
  subject?: string | string[];
}

const arr = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** Release tags of ripped commercial copies, and labels of piracy groups. */
const RIP_TAGS = /\b(dvd ?rip|bd ?rip|blu ?-?ray|web ?-?(dl|rip)|hd ?rip|cam ?rip|pre ?dvd|hdts|x ?26[45]|h ?26[45]|hevc|[0-9]{3,4}p|dubbed|esubs?|org ?movies|hindi ?dub|dual ?audio|hq)\b/i;
/** Adult titles, subjects or collections. */
const ADULT = /\b(adult|erotic|erotica|sexploitation|porn\w*|xxx|nudity|nudist|stag films?|perversions?|softcore|hardcore|sex)\b/i;
/** Collections where anyone uploads; an undated item from these is not trusted. */
const OPEN_COLLECTIONS = /^(feature_films_unsorted|opensource_movies|community|folksoundomy.*|television_inbox|additional_collections_video|individual-image-collections|social-media-video|deemphasize|capcutmod)$/i;

export function yearOf(d: SearchDoc): number | null {
  const y = Number(String(d.year || '').slice(0, 4)) || Number(String(d.date || '').slice(0, 4));
  return y > 1870 && y < 2100 ? y : null;
}

/** Whether an item marked public domain is credible enough to offer. Pure. */
export function archiveEligible(d: SearchDoc, set: ArchiveSet): { ok: boolean; reason?: string } {
  const title = arr(d.title).join(' ');
  if (!/publicdomain/i.test(d.licenseurl || '')) return { ok: false, reason: 'not marked public domain' };
  if (RIP_TAGS.test(title)) return { ok: false, reason: 'title carries rip/release tags (a copy of a commercial release)' };
  const tags = `${title} ${arr(d.subject).join(' ')} ${arr(d.collection).join(' ')}`;
  if (ADULT.test(tags)) return { ok: false, reason: 'adult content (not offered in the app)' };
  const year = yearOf(d);
  // A year in the title ("Rockstar (2011)") counts too.
  const titleYear = /\((\d{4})\)|\b(19[0-9]{2}|20[0-9]{2})\b/.exec(title);
  const ty = titleYear ? Number(titleYear[1] || titleYear[2]) : null;
  const latest = Math.max(year || 0, ty || 0);
  if (latest > set.maxYear) return { ok: false, reason: `released ${latest}, too recent to be public domain` };
  const collections = arr(d.collection);
  if (!latest && collections.every((c) => OPEN_COLLECTIONS.test(c) || /^fav-/.test(c) || c === 'movies' || c === 'moviesandfilms' || c === 'television'))
    return { ok: false, reason: 'undated upload outside curated collections' };
  return { ok: true };
}

export interface ArchiveFile {
  name: string;
  title?: string;
  length?: number;
  size?: number;
}

export interface ArchiveItem {
  id: string;
  set: string;
  kind: 'films' | 'tv';
  title: string;
  year: number | null;
  language: string;
  licenseurl: string;
  genre: string;
  downloads: number;
  files: ArchiveFile[];
}

/** Playable files: H.264 derivatives (always H.264/AAC MP4), else original MP4s. Pure. */
export function playableFiles(files: { name: string; format?: string; title?: string; length?: string; size?: string; source?: string }[]): ArchiveFile[] {
  const mp4 = files.filter((f) => /\.mp4$/i.test(f.name));
  const h264 = mp4.filter((f) => /^h\.264/i.test(f.format || ''));
  const pick = h264.length ? h264 : mp4.filter((f) => /mpeg4/i.test(f.format || ''));
  // One file per original: prefer the HD derivative over the 512kb one.
  const byBase = new Map<string, (typeof pick)[number]>();
  for (const f of pick) {
    const base = f.name.replace(/(\.ia|_512kb|\.h264)?\.mp4$/i, '');
    const cur = byBase.get(base);
    if (!cur || Number(f.size || 0) > Number(cur.size || 0)) byBase.set(base, f);
  }
  return Array.from(byBase.values())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((f) => {
      const len = /^\d+(\.\d+)?$/.test(f.length || '') ? Number(f.length) : f.length && /:/.test(f.length) ? f.length.split(':').reduce((s, x) => s * 60 + Number(x), 0) : undefined;
      const out: ArchiveFile = { name: f.name };
      if (f.title) out.title = f.title;
      if (len) out.length = Math.round(len);
      if (f.size) out.size = Number(f.size);
      return out;
    });
}

const GENRES: [RegExp, string][] = [
  [/comedy/i, 'Comedy'],
  [/noir/i, 'Film noir'],
  [/scifi|horror/i, 'Sci-fi & horror'],
  [/western/i, 'Westerns'],
  [/silent/i, 'Silent films'],
  [/animation|cartoon/i, 'Animation'],
  [/classic_tv_1940s/i, '1940s TV'],
  [/classic_tv_1950s/i, '1950s TV'],
  [/classic_tv_1960s/i, '1960s TV'],
  [/classic_tv_1970s/i, '1970s TV'],
];

function genreOf(d: SearchDoc, set: ArchiveSet): string {
  const c = arr(d.collection).join(' ');
  for (const [re, g] of GENRES) if (re.test(c)) return g;
  return set.kind === 'tv' ? 'Classic TV' : 'Feature films';
}

let lastCall = 0;
async function getJson<T>(url: string): Promise<T | null> {
  const wait = lastCall + 250 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  return null;
}

export interface ArchiveResult {
  items: ArchiveItem[];
  excluded: { id: string; set: string; title: string; reason: string }[];
  notResolved: number;
}

/** Resolves eligible items from the stored search responses into playable files (cached). */
export async function resolveArchive(dir: string, log: (m: string) => void, opts: { offline?: boolean } = {}): Promise<ArchiveResult> {
  const base = join(dir, 'repositories/internet-archive');
  const metaDir = join(base, 'meta');
  mkdirSync(metaDir, { recursive: true });
  const items: ArchiveItem[] = [];
  const excluded: ArchiveResult['excluded'] = [];
  let notResolved = 0;
  for (const set of ARCHIVE_SETS) {
    const p = join(base, set.file);
    if (!existsSync(p)) {
      log(`internet-archive ${set.id}: search response not collected`);
      continue;
    }
    const docs = ((JSON.parse(readFileSync(p, 'utf8')) as { response?: { docs?: SearchDoc[] } }).response || {}).docs || [];
    const eligible: SearchDoc[] = [];
    for (const d of docs) {
      const e = archiveEligible(d, set);
      if (e.ok) eligible.push(d);
      else excluded.push({ id: d.identifier, set: set.id, title: arr(d.title).join(' ').slice(0, 120), reason: e.reason! });
    }
    let fetched = 0;
    for (const d of eligible.slice(0, set.cap)) {
      const cache = join(metaDir, `${d.identifier.replace(/[^\w.-]/g, '_')}.json`);
      let files: ArchiveFile[] | null = null;
      if (existsSync(cache)) files = JSON.parse(readFileSync(cache, 'utf8')) as ArchiveFile[];
      else if (!opts.offline) {
        type RawFile = { name: string; format?: string; title?: string; length?: string; size?: string };
        const meta = await getJson<{ result?: RawFile[]; files?: RawFile[] }>(`https://archive.org/metadata/${encodeURIComponent(d.identifier)}/files`);
        fetched++;
        if (meta) {
          files = playableFiles(meta.result || meta.files || []);
          writeFileSync(cache, JSON.stringify(files));
        }
        if (fetched % 100 === 0) log(`internet-archive ${set.id}: ${fetched} items looked up`);
      }
      if (!files) {
        notResolved++;
        continue;
      }
      if (!files.length) {
        excluded.push({ id: d.identifier, set: set.id, title: arr(d.title).join(' ').slice(0, 120), reason: 'no playable MP4 file' });
        continue;
      }
      items.push({
        id: d.identifier,
        set: set.id,
        kind: set.kind,
        title: arr(d.title).join(' ').trim() || d.identifier,
        year: yearOf(d),
        language: set.language,
        licenseurl: d.licenseurl || '',
        genre: genreOf(d, set),
        downloads: d.downloads || 0,
        files,
      });
    }
    log(`internet-archive ${set.id}: ${docs.length} marked public domain, ${eligible.length} credible, ${items.filter((i) => i.set === set.id).length} playable`);
  }
  const result: ArchiveResult = { items, excluded, notResolved };
  writeFileSync(join(base, 'items.json'), JSON.stringify(result));
  return result;
}

export function readArchive(dir: string): ArchiveResult | null {
  const p = join(dir, 'repositories/internet-archive/items.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ArchiveResult) : null;
}
