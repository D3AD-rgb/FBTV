/**
 * TV export: the webOS app cannot read folders on the PC, so the library is exported as a
 * compact bundle that is either built into the app package (copied by the Vite build from
 * build-data/library-export) or served on the home network by `npm run library:serve`.
 *
 * The bundle contains no credentials: provider profiles are listed by name/capabilities only.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { gzipSync } from 'node:zlib';
import { timingSafeEqual } from 'node:crypto';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
import { isNews, isSports, type CatalogChannel, type Registry, type RegistryItem } from './catalogs.ts';
import { REPO_ROOT } from './paths.ts';
import { isPrivateSource, loadPrivateRefs, privateRef } from './privateUrls.ts';
import { srtToVtt, type LocalItem } from './localMedia.ts';
import { loadProfiles, type XtreamProfile } from './profiles.ts';
import { getCredentials } from './secrets.ts';
import { playUrl } from './xtream.ts';

/** Repositories whose channels go in the primary shard (curated public sources and your profiles). */
const PRIMARY = ['iptv-org', 'free-tv'];

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
  /** List membership computed on the PC: n = news, s = sports (includes group-name matches). */
  t?: string[];
  p: 0 | 1;
  r: string[];
  st: { u: string; s: string; v: string; q?: string; x?: string[]; m?: string }[];
}

export function compact(c: CatalogChannel): CompactChannel {
  const out: CompactChannel = {
    i: c.id,
    n: c.name,
    p: c.playable ? 1 : 0,
    r: c.repos,
    st: c.streams.slice(0, 6).map((s) => {
      // Your own sources' addresses stay on the PC (resolved by the library server at play time).
      const own = s.sources.some((x) => isPrivateSource(x.repo));
      const o: CompactChannel['st'][number] = { u: own ? privateRef(s.url) : s.url, s: s.status, v: s.validation };
      if (s.quality) o.q = s.quality;
      const x = s.restrictions.filter((r) => r !== 'pay-tv-brand');
      if (x.length) o.x = x;
      if (s.measured) o.m = `${s.measured.width}x${s.measured.height}`;
      return o;
    }),
  };
  if (c.altNames.length) out.a = c.altNames.slice(0, 4);
  if (c.country) out.c = c.country;
  if (c.languages.length) out.l = c.languages;
  if (c.categories.length) out.g = c.categories;
  if (c.logo) out.o = c.logo;
  if (c.epgId) out.e = c.epgId;
  if (c.sports.length) out.sp = c.sports;
  if (c.football) out.f = c.football;
  if (c.payTvBrand) out.pay = 1;
  if (c.kind === 'radio') out.k = 'r';
  const t: string[] = [];
  if (isNews(c)) t.push('n');
  if (isSports(c)) t.push('s');
  if (t.length) out.t = t;
  return out;
}

/** Selection rule a registry item applies to the channel shards (so lists are not duplicated). */
export function selectFor(item: RegistryItem): Record<string, string> | null {
  const id = item.id;
  const m = /^(country|language|category|source|sport)-(.+)$/.exec(id);
  if (m) return { [m[1]!]: m[2]! };
  const prof = /^profile-(.+)$/.exec(id);
  if (prof && !/^profile-(error|setup)-/.test(id)) return { source: `profile:${prof[1]}` };
  const fixed: Record<string, Record<string, string>> = {
    'live-all': { kind: 'stream' },
    'movie-channels': { category: 'movies' },
    'series-channels': { category: 'series' },
    'news-all': { news: 'any' },
    'news-english': { news: 'any', language: 'eng' },
    'news-uk': { news: 'any', country: 'uk' },
    'news-arabic': { news: 'any', language: 'ara' },
    'sports-all': { sport: 'any' },
    'sports-english': { sport: 'any', language: 'eng' },
    'sports-arabic': { sport: 'any', language: 'ara' },
    'sports-other-languages': { sport: 'any', language: 'not-eng-ara' },
    'football-all': { football: 'any' },
    'football-dedicated': { football: 'dedicated' },
    'football-clubs': { football: 'club' },
    'football-broadcasters': { football: 'broadcaster-brand' },
    'football-english': { football: 'any', language: 'eng' },
    'football-arabic': { football: 'any', language: 'ara' },
    radio: { kind: 'radio' },
    reachable: { validation: 'reachable' },
    'playback-confirmed': { validation: 'playback_confirmed' },
    '4k': { quality: '4k' },
  };
  return fixed[id] || null;
}

export function exportDir(): string {
  return resolve(process.env.FBTV_LIBRARY_EXPORT || join(REPO_ROOT, 'build-data', 'library-export'));
}

/**
 * Writes the TV export into a staging folder and swaps it in only when everything succeeded, so a
 * failed build leaves the last good export (and the one before it, as .previous) in place.
 * `extras` writes additional files (source playlists, local media) into the staging folder.
 */
export function exportForTv(
  dataDir: string,
  channels: CatalogChannel[],
  registry: Registry,
  extras?: (stagingDir: string) => void,
): { dir: string; files: Record<string, number> } {
  const out = exportDir();
  const staging = `${out}.staging`;
  const previous = `${out}.previous`;
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  mkdirSync(join(staging, 'shards'), { recursive: true });
  const files: Record<string, number> = {};
  const put = (rel: string, data: unknown) => {
    const text = JSON.stringify(data);
    mkdirSync(join(staging, rel, '..'), { recursive: true });
    writeFileSync(join(staging, rel), text);
    files[rel] = text.length;
  };
  try {
    const primary = channels.filter((c) => c.repos.some((r) => PRIMARY.indexOf(r) >= 0 || r.indexOf('profile:') === 0));
    const secondary = channels.filter((c) => !c.repos.some((r) => PRIMARY.indexOf(r) >= 0 || r.indexOf('profile:') === 0));
    put('shards/primary.json', primary.map(compact));
    put('shards/secondary.json', secondary.map(compact));

    const items = registry.items.map((i) => {
      const x: Record<string, unknown> = {
        id: i.id,
        name: i.name,
        group: i.group,
        type: i.type,
        contentType: i.contentType,
        languages: i.languages,
        channels: i.channels,
        status: i.importStatus,
        validation: i.validation,
      };
      if (i.note) x.note = i.note;
      if (i.error) x.error = i.error;
      const sel = selectFor(i);
      if (sel) x.select = sel;
      if (i.type === 'catalog' && i.path) x.catalog = i.path.replace(/^catalogs\//, '');
      if (i.url && i.contentType === 'epg') x.url = i.url;
      return x;
    });
    put('registry.json', {
      schema: 1,
      generatedAt: registry.generatedAt,
      shards: { primary: { file: 'shards/primary.json', channels: primary.length }, secondary: { file: 'shards/secondary.json', channels: secondary.length, note: 'Channels only found in unlicensed or mixed-provenance lists (mostly mainland China)' } },
      groups: registry.groups,
      items,
    });

    for (const f of ['football.json', 'sports.json', 'fixtures.json', 'movies.json', 'series.json', 'episodes.json']) {
      const p = join(dataDir, 'catalogs', f);
      if (!existsSync(p)) continue;
      const data = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;
      if (f === 'football.json') {
        // Stream URLs live in the shards; keep the football catalog light.
        data.channels = (data.channels as { id: string; role: string; playable: boolean }[]).map((c) => ({ id: c.id, role: c.role, playable: c.playable }));
      }
      put(f, data);
    }
    if (extras) extras(staging);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw new Error(`TV export failed; the previous export is unchanged: ${(err as Error).message}`);
  }
  if (existsSync(previous)) rmSync(previous, { recursive: true, force: true });
  if (existsSync(out)) renameSync(out, previous);
  renameSync(staging, out);
  return { dir: out, files };
}

// ------------------------------------------------------------------ home-network server

const PRIVATE_V4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/;

/** Loopback or a private-network address (IPv4, IPv4-mapped IPv6, or IPv6 link-local/ULA). Pure. */
export function isPrivateClient(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  return a === '::1' || PRIVATE_V4.test(a) || /^f[cd][0-9a-f]{2}:|^fe80:/i.test(a);
}

/** The PC's address on the home network (first private IPv4), for binding. */
export function lanAddress(): string | null {
  const ifs = networkInterfaces();
  for (const k of Object.keys(ifs)) for (const a of ifs[k] || []) if (a.family === 'IPv4' && !a.internal && PRIVATE_V4.test(a.address)) return a.address;
  return null;
}

export interface PlaylistSettings {
  version: 1;
  updatedAt: string;
  selected: string[];
  saved?: { selected: string[]; savedAt: string } | null;
  custom: { id: string; name: string; members: string[]; createdAt: string; updatedAt: string }[];
}

/** Checks a settings document from the TV before it is written. Pure. */
export function validSettings(x: unknown): x is PlaylistSettings {
  const s = x as PlaylistSettings;
  const ids = (a: unknown, max: number) => Array.isArray(a) && a.length <= max && a.every((v) => typeof v === 'string' && v.length <= 200);
  if (!s || typeof s !== 'object' || s.version !== 1 || typeof s.updatedAt !== 'string') return false;
  if (!ids(s.selected, 10000)) return false;
  if (s.saved && !(ids(s.saved.selected, 10000) && typeof s.saved.savedAt === 'string')) return false;
  if (!Array.isArray(s.custom) || s.custom.length > 500) return false;
  return s.custom.every((c) => c && typeof c.id === 'string' && c.id.length <= 64 && typeof c.name === 'string' && c.name.length > 0 && c.name.length <= 120 && ids(c.members, 5000));
}

export function settingsPath(dataDir: string): string {
  return join(dataDir, 'settings', 'playlists.json');
}

export function readSettings(dataDir: string): PlaylistSettings | null {
  const p = settingsPath(dataDir);
  if (!existsSync(p)) return null;
  try {
    const s = JSON.parse(readFileSync(p, 'utf8'));
    return validSettings(s) ? s : null;
  } catch {
    return null;
  }
}

/** Atomic write with a backup of the previous version. */
export function writeSettings(dataDir: string, s: PlaylistSettings): void {
  const p = settingsPath(dataDir);
  mkdirSync(join(p, '..'), { recursive: true });
  if (existsSync(p)) copyFileSync(p, `${p}.bak`);
  writeFileSync(`${p}.tmp`, JSON.stringify(s, null, 1));
  renameSync(`${p}.tmp`, p);
}

const gzipCache = new Map<string, { at: number; body: Buffer }>();

/** An export file, gzipped when the client accepts it (cached per file version; shards are megabytes). */
function sendJson(req: IncomingMessage, res: ServerResponse, file: string): void {
  const headers: Record<string, string> = { 'Content-Type': 'application/json; charset=utf-8', Vary: 'Accept-Encoding' };
  const at = statSync(file).mtimeMs;
  if (!/\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    res.writeHead(200, headers);
    return void res.end(readFileSync(file));
  }
  let hit = gzipCache.get(file);
  if (!hit || hit.at !== at) {
    hit = { at, body: gzipSync(readFileSync(file), { level: 6 }) };
    gzipCache.set(file, hit);
    if (gzipCache.size > 64) gzipCache.delete(gzipCache.keys().next().value as string);
  }
  res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': String(hit.body.length) });
  res.end(hit.body);
}

const MEDIA_TYPES: Record<string, string> = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm', avi: 'video/x-msvideo',
  ts: 'video/mp2t', m2ts: 'video/mp2t', mpg: 'video/mpeg', mpeg: 'video/mpeg', wmv: 'video/x-ms-wmv', flv: 'video/x-flv',
};

function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string): void {
  const size = statSync(file).size;
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Content-Type', type);
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    if (start < 0) start = 0;
    if (end >= size) end = size - 1;
    if (start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    if (req.method === 'HEAD') return void res.end();
    createReadStream(file, { start, end }).pipe(res);
    return;
  }
  res.setHeader('Content-Length', String(size));
  if (req.method === 'HEAD') return void res.end();
  createReadStream(file).pipe(res);
}

/**
 * Serves the export on the home network so the TV can refresh without reinstalling, and plays
 * your media and private playlist entries. Binds to the PC's home-network address only and
 * answers only private-network clients. Nothing outside the export, your media index and the
 * playlist settings file can be requested; no file path or credential is ever sent.
 */
/** An access key: 16–128 letters, digits, "-" or "_". Pure. */
export function validKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{16,128}$/.test(key);
}

/**
 * With an access key every address starts with /k/<key>/ (the TV's library address carries it);
 * returns the path after it, or null when the key is missing or wrong. Without a key, the path. Pure.
 */
export function stripKey(path: string, key: string | undefined): string | null {
  if (!key) return path;
  const m = /^\/k\/([^/]+)(\/.*)?$/.exec(path);
  if (!m) return null;
  const given = Buffer.from(m[1]!);
  const want = Buffer.from(key);
  if (given.length !== want.length || !timingSafeEqual(given, want)) return null;
  return m[2] || '/';
}

/** Shows an address with its access key hidden (for logs). Pure. */
export function maskKey(url: string): string {
  return url.replace(/\/k\/([^/]{4})[^/]*/, '/k/$1…');
}

/**
 * Serves the TV export, your media by id, private play tokens and the playlist settings file.
 * At home it binds to the PC's home-network address and answers private-network clients only.
 * On an always-on server (e.g. a cloud VM published through Tailscale Funnel) it binds to
 * 127.0.0.1 and requires the access key in every address (opts.key).
 */
export function serve(port: number, dataDir: string, opts: { host?: string; key?: string } = {}): void {
  const root = exportDir();
  const host = opts.host || lanAddress() || '127.0.0.1';
  const key = opts.key;
  if (key !== undefined && !validKey(key)) throw new Error('The access key must be 16–128 letters, digits, "-" or "_".');
  const json = { 'Content-Type': 'application/json; charset=utf-8' };
  let media: { at: number; items: Map<string, LocalItem> } = { at: 0, items: new Map() };
  const mediaIndex = () => {
    const p = join(dataDir, 'catalogs', 'local-media.json');
    if (!existsSync(p)) return media.items;
    const at = statSync(p).mtimeMs;
    if (at !== media.at) media = { at, items: new Map(((JSON.parse(readFileSync(p, 'utf8')) as { items: LocalItem[] }).items || []).map((i) => [i.id, i])) };
    return media.items;
  };
  createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');
    if (!isPrivateClient(req.socket.remoteAddress)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    if (req.method === 'OPTIONS') return void res.end();
    let url: string;
    try {
      url = decodeURIComponent((req.url || '/').split('?')[0]!);
    } catch {
      res.statusCode = 400;
      return void res.end('bad request');
    }
    const inner = stripKey(url, key);
    if (inner === null) {
      res.statusCode = 404;
      return void res.end('not found');
    }
    url = inner;
    if (url === '/registry.json') console.log(`[library] ${new Date().toISOString()} library requested`);
    const fail = (code: number, msg: string) => {
      res.statusCode = code;
      res.end(msg);
    };

    // Playlist selections and custom playlists (the only writable file).
    if (url === '/settings/playlists.json') {
      if (req.method === 'PUT') {
        let body = '';
        let tooBig = false;
        req.on('data', (c: Buffer) => {
          body += c.toString('utf8');
          if (body.length > 512 * 1024) tooBig = true;
        });
        req.on('end', () => {
          if (tooBig) return fail(413, 'too large');
          let parsed: unknown;
          try {
            parsed = JSON.parse(body);
          } catch {
            return fail(400, 'not JSON');
          }
          if (!validSettings(parsed)) return fail(422, 'not a playlist settings document');
          writeSettings(dataDir, parsed);
          res.writeHead(200, json);
          res.end(JSON.stringify({ ok: true }));
        });
        return;
      }
      res.writeHead(200, json);
      return void res.end(JSON.stringify(readSettings(dataDir) || { version: 1, updatedAt: '', selected: [], saved: null, custom: [] }));
    }

    // Private playlist entries: resolve the token to the real address at play time.
    const play = /^\/play\/([0-9a-f]{24})$/.exec(url);
    if (play) {
      const target = loadPrivateRefs(dataDir).get(play[1]!);
      if (!target) return fail(404, 'unknown entry');
      res.statusCode = 302;
      res.setHeader('Location', target);
      res.setHeader('Cache-Control', 'no-store');
      return void res.end();
    }

    // Your Xtream provider: the play address is built from your stored login on this PC only.
    const xt = /^\/xtream\/([\w.-]{1,64})\/(movie|series|live)\/([\w-]{1,32})\.(\w{1,5})$/.exec(url);
    if (xt) {
      const profile = loadProfiles(dataDir).profiles.filter((p) => p.type === 'xtream' && p.id === xt[1])[0] as XtreamProfile | undefined;
      const creds = profile ? getCredentials(dataDir, profile.id) : null;
      if (!profile || !creds) return fail(404, 'provider not configured');
      res.statusCode = 302;
      res.setHeader('Location', playUrl(profile, creds, xt[2] as 'movie' | 'series' | 'live', xt[3]!, xt[4]!));
      res.setHeader('Cache-Control', 'no-store');
      return void res.end();
    }

    // Your media files, by id.
    // The film URL may end in its extension (".mp4") so the TV picks the right player.
    const m = /^\/media\/([0-9a-f]{16})(?:\.[a-z0-9]{2,5}|\/(art|sub\/(\d{1,2})\.vtt))?$/.exec(url);
    if (m) {
      const item = mediaIndex().get(m[1]!);
      if (!item || !item.path || !existsSync(item.path)) return fail(404, 'not found');
      if (m[2] === 'art') {
        if (!item.artPath || !existsSync(item.artPath)) return fail(404, 'no artwork');
        return sendFile(req, res, item.artPath, /\.png$/i.test(item.artPath) ? 'image/png' : 'image/jpeg');
      }
      if (m[3] !== undefined) {
        const sub = item.subtitles.filter((s) => s.id === Number(m[3]))[0];
        if (!sub || !sub.path || !existsSync(sub.path)) return fail(404, 'no subtitles');
        const text = readFileSync(sub.path, 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/vtt; charset=utf-8' });
        return void res.end(/\.vtt$/i.test(sub.path) ? text : srtToVtt(text));
      }
      return sendFile(req, res, item.path, MEDIA_TYPES[item.ext] || 'application/octet-stream');
    }

    // The export (JSON only).
    const file = resolve(root, '.' + (url === '/' ? '/registry.json' : url));
    if (!file.startsWith(root + sep) || extname(file) !== '.json' || !existsSync(file)) return fail(404, 'not found');
    sendJson(req, res, file);
  }).listen(port, host, () => {
    const base = `http://${host}:${port}${key ? `/k/${key}` : ''}`;
    console.log(`[library] serving the TV library on http://${host}:${port} (${key ? 'access key required' : 'home network only'}; ${readdirSync(root).length} entries)`);
    console.log(`[library] TV library URL: ${maskKey(`${base}/registry.json`)}`);
    console.log('[library] Serves the export, your media by id and the playlist settings file. Ctrl+C to stop.');
  });
}
