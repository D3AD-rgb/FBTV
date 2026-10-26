/**
 * TV export: the webOS app cannot read folders on the PC, so the library is exported as a
 * compact bundle that is either built into the app package (copied by the Vite build from
 * build-data/library-export) or served on the home network by `npm run library:serve`.
 *
 * The bundle contains no credentials: provider profiles are listed by name/capabilities only.
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { isNews, isSports, type CatalogChannel, type Registry, type RegistryItem } from './catalogs.ts';
import { REPO_ROOT } from './paths.ts';

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
      const o: CompactChannel['st'][number] = { u: s.url, s: s.status, v: s.validation };
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
  };
  return fixed[id] || null;
}

export function exportDir(): string {
  return resolve(process.env.FBTV_LIBRARY_EXPORT || join(REPO_ROOT, 'build-data', 'library-export'));
}

export function exportForTv(dataDir: string, channels: CatalogChannel[], registry: Registry): { dir: string; files: Record<string, number> } {
  const out = exportDir();
  if (existsSync(out)) rmSync(out, { recursive: true, force: true });
  mkdirSync(join(out, 'shards'), { recursive: true });
  const files: Record<string, number> = {};
  const put = (rel: string, data: unknown) => {
    const text = JSON.stringify(data);
    writeFileSync(join(out, rel), text);
    files[rel] = text.length;
  };
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
  return { dir: out, files };
}

/** Serves the export on the home network so the TV can refresh without reinstalling. */
export function serve(port: number): void {
  const root = exportDir();
  const types: Record<string, string> = { '.json': 'application/json; charset=utf-8' };
  createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]!);
    const file = resolve(root, '.' + (url === '/' ? '/registry.json' : url));
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (!file.startsWith(root) || !existsSync(file)) {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream');
    res.end(readFileSync(file));
  }).listen(port, '0.0.0.0', () => {
    const addrs: string[] = [];
    const ifs = networkInterfaces();
    for (const k of Object.keys(ifs)) for (const a of ifs[k] || []) if (a.family === 'IPv4' && !a.internal) addrs.push(a.address);
    console.log(`[library] serving ${root} (${readdirSync(root).length} entries)`);
    for (const a of addrs) console.log(`[library] TV library URL: http://${a}:${port}/registry.json`);
    console.log('[library] Only JSON from the export folder is served (read-only). Ctrl+C to stop.');
  });
}
