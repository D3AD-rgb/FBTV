/**
 * The discovery inventory: one record per discovered item — every playlist entry, every
 * malformed line, every website/app-channel/EPG source/provider adapter/reference — with its
 * provenance, explicit status and reasons. Nothing is dropped here; catalogs and playlists
 * are derived views over these records.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlaylist, splitTitle, type M3UEntry } from '../shared/m3u.ts';
import { canonicalName, normalizeCountry, normalizeLanguages, slug, streamFingerprint } from '../shared/normalize.ts';
import { fetchText } from '../builder/fetch.ts';
import { gitShow, snapshotDir, type Manifest, type ManifestFile } from './collect.ts';
import { footballRole, PAY_TV_RELAY, sportsOf, type FootballRole, EXTRA_SPORTS, isPaySports, streamPlatform } from './policy.ts';
import type { Handling, Permission } from './repos.ts';
import { REPOS } from './repos.ts';
import { loadProfiles } from './profiles.ts';
import { readArchive } from './archive.ts';

export type RecordStatus =
  | 'imported'
  | 'duplicate_reference'
  | 'unsupported_format'
  | 'restricted'
  | 'requires_provider_access'
  | 'malformed'
  | 'test_fixture'
  | 'reference_only';

/** Not yet checked · URL reachable · media format recognised · playback confirmed · temporarily unavailable · playback failed. */
export type ValidationStatus = 'untested' | 'reachable' | 'format_recognised' | 'temporarily_unavailable' | 'playback_confirmed' | 'playback_failed';

export type RecordKind =
  | 'stream'
  | 'radio'
  | 'vod'
  | 'channel-without-url'
  | 'website'
  | 'epg-source'
  | 'provider-adapter'
  | 'reference'
  | 'template'
  | 'malformed-line';

export interface RecordMeta {
  tvgId?: string;
  channelId?: string;
  feed?: string;
  logo?: string;
  group?: string;
  country?: string;
  languages: string[];
  languageSource: 'iptv-org' | 'playlist' | 'profile' | 'archive' | 'none';
  categories: string[];
  quality?: string;
  labels: string[];
  epgId?: string;
  sports: string[];
  football?: FootballRole;
  payTvBrand?: boolean;
  restrictions: string[];
  durationSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface InventoryRecord {
  uid: string;
  kind: RecordKind;
  name: string;
  url: string | null;
  urlWithheldReason?: string;
  source: { repo: string; file: string; line: number; originUrl: string; permission: Permission | 'n/a'; handling: Handling | 'n/a' };
  meta: RecordMeta;
  importedAt: string;
  status: RecordStatus;
  reasons: string[];
  streamId?: string;
  channelKey?: string;
  duplicateOf?: string;
  validation: ValidationStatus;
}

// ------------------------------------------------------------------ iptv-org metadata
export interface ApiIndex {
  channels: Map<string, { name: string; country?: string; categories?: string[]; alt_names?: string[] }>;
  feeds: Map<string, { languages?: string[] }>;
  mainFeed: Map<string, string>;
}

export function buildApiIndex(
  channels: { id: string; name: string; country?: string; categories?: string[]; alt_names?: string[] }[],
  feeds: { channel: string; id: string; languages?: string[]; is_main?: boolean }[],
): ApiIndex {
  const idx: ApiIndex = { channels: new Map(), feeds: new Map(), mainFeed: new Map() };
  for (const c of channels) idx.channels.set(c.id, c);
  for (const f of feeds) {
    idx.feeds.set(`${f.channel}@${f.id}`, f);
    if (f.is_main) idx.mainFeed.set(f.channel, f.id);
  }
  return idx;
}

export function loadApi(dir: string): ApiIndex | null {
  const ch = join(dir, 'repositories/iptv-org/api/channels.json');
  const fe = join(dir, 'repositories/iptv-org/api/feeds.json');
  if (!existsSync(ch) || !existsSync(fe)) return null;
  return buildApiIndex(JSON.parse(readFileSync(ch, 'utf8')), JSON.parse(readFileSync(fe, 'utf8')));
}

// ------------------------------------------------------------------ classification
/** File extensions that mean a single on-demand file. Not .flv or .ts: HTTP-FLV and raw TS are live formats. */
const MEDIA_FILE = /\.(mp4|mkv|avi|mov|m4v|wmv|webm)(\?|$)/i;
const WEB_PAGE = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be|twitch\.tv|dailymotion\.com|facebook\.com)\//i;
const PRIVATE_HOST = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/;

/**
 * Xtream-style stream URLs carry an account in the path or query:
 * http://host:port/[live|movie|series/]<user>/<pass>/<id>[.ts|.m3u8|...] or get.php?username=&password=.
 * Only the explicit-port form is matched, which CDN paths do not use. Pure.
 */
export function providerAccountUrl(url: string): boolean {
  if (/[?&](username|user)=[^&]+&(password|pass)=/i.test(url)) return true;
  const m = /^https?:\/\/[^/:?#]+:(\d+)(\/[^?#]*)/i.exec(url);
  if (!m) return false;
  return /^\/(?:live\/|movie\/|series\/)?[^/]+\/[^/]+\/\d+(?:\.(?:ts|m3u8|mp4|mkv|avi))?$/i.test(m[2]!);
}
/** Pay-TV brands flagged (never withheld) in curated public sources. */
export const PAY_TV_BRAND = /\b(bein|sky sports?|sky cinema|tnt sports|bt sport|dazn|supersport|premier sports|ssc ?\d|osn|eurosport|espn|canal\+ ?sport|movistar|setanta|hbo|cinemax)\b/i;

export function protocolOf(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return m ? m[1]!.toLowerCase() : 'other';
}

export function uidOf(repo: string, file: string, line: number, index = 0): string {
  return createHash('sha1').update(`${repo}|${file}|${line}|${index}`).digest('hex').slice(0, 16);
}

export interface SourceCtx {
  repo: string;
  file: string;
  originUrl: string;
  permission: Permission;
  handling: Handling;
  category: string;
  policy: 'keep' | 'withhold-pay' | 'withhold-all';
  reason?: string;
}

/** Classifies one playlist entry into an inventory record (status, reasons, metadata). Pure. */
export function classifyStream(e: M3UEntry, ctx: SourceCtx, api: ApiIndex | null, importedAt: string, index = 0): InventoryRecord {
  const title = splitTitle(e.title || e.attrs['tvg-name'] || '');
  const cleanName = title.name.replace(/[ⓈⒼⓎⓉ]/g, '').replace(/\s+/g, ' ').trim();
  const tvgId = (e.attrs['tvg-id'] || '').trim();
  const [baseId, feedId] = tvgId.split('@') as [string, string | undefined];
  const apiChannel = api && baseId ? api.channels.get(baseId) : undefined;
  const feedKey = apiChannel && api ? `${baseId}@${feedId || api.mainFeed.get(baseId) || ''}` : '';
  const apiFeed = apiChannel && api ? api.feeds.get(feedKey) : undefined;

  const url = e.url.trim();
  const protocol = protocolOf(url);
  const restrictions: string[] = [];
  const hm = /^[a-z]+:\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(url);
  const host = hm ? hm[1]! : '';
  if (e.userAgent || e.referrer) restrictions.push('needs-headers');
  if (protocol !== 'http' && protocol !== 'https') restrictions.push(`protocol:${protocol}`);
  if (PRIVATE_HOST.test(host) || /^(rtp|udp|igmp|rtsp)$/.test(protocol)) restrictions.push('isp-or-lan-only');
  if (providerAccountUrl(url)) restrictions.push('provider-account-url');
  const platform = streamPlatform(url, host);
  if (platform === 'restream') restrictions.push('restream-host');
  if (/^\[/.test(host)) restrictions.push('ipv6-only');
  if (/\.mpd(\?|$)/i.test(url)) restrictions.push('dash');
  if (WEB_PAGE.test(url)) restrictions.push('web-page-not-stream');
  for (const l of title.labels) {
    if (/geo/i.test(l)) restrictions.push('geo-blocked');
    else if (/24\/7/.test(l)) restrictions.push('not-24-7');
  }
  if (/Ⓖ/.test(e.title)) restrictions.push('geo-blocked');
  if (/invalid\//i.test(ctx.file)) restrictions.push('marked-invalid-by-source');

  const group = e.group || undefined;
  let languages: string[] = [];
  let languageSource: RecordMeta['languageSource'] = 'none';
  if (apiFeed && apiFeed.languages && apiFeed.languages.length) {
    languages = apiFeed.languages.slice();
    languageSource = 'iptv-org';
  } else {
    const attr = normalizeLanguages([e.attrs['tvg-language']]);
    if (attr.length) {
      languages = attr;
      languageSource = 'playlist';
    }
  }
  const country =
    (apiChannel && apiChannel.country) ||
    normalizeCountry(e.attrs['tvg-country']) ||
    (baseId && /\.[a-z]{2}$/i.test(baseId) ? normalizeCountry(baseId.slice(-2)) : undefined);
  const categories = apiChannel && apiChannel.categories ? apiChannel.categories.slice() : [];
  const altNames = apiChannel && apiChannel.alt_names ? apiChannel.alt_names : [];
  const groups = group ? [group] : [];
  const sportsCategory = categories.indexOf('sports') >= 0 || groups.some((g) => /\bsport|体育|體育|رياض/i.test(g));
  const sports = sportsCategory ? sportsOf(cleanName, group, altNames.join(' ')) : sportsOf(cleanName).filter((s) => s === 'football' || s === 'motorsport' || s === 'cricket');
  for (const extra of EXTRA_SPORTS[baseId] || []) if (sports.indexOf(extra) < 0) sports.push(extra);
  const football = footballRole(cleanName, groups, categories, sportsCategory);
  const sportsChannel = sportsCategory || sports.length > 0;
  const paySports = isPaySports(cleanName, sportsChannel) || (!!apiChannel && isPaySports(apiChannel.name, sportsChannel));
  if (platform === 'official' && !paySports && !PAY_TV_RELAY.test(cleanName)) restrictions.push('official-platform');
  if (football && sports.indexOf('football') < 0) sports.unshift('football');
  const payTvBrand = PAY_TV_BRAND.test(cleanName);
  if (payTvBrand) restrictions.push('pay-tv-brand');

  const kind: RecordKind = ctx.category === 'radio' || e.attrs.radio === 'true' ? 'radio' : e.duration > 0 || MEDIA_FILE.test(url) ? 'vod' : 'stream';

  // ---- status
  const reasons: string[] = [];
  let status: RecordStatus = 'imported';
  let keptUrl: string | null = url;
  let withheld: string | undefined;
  const relayPay = PAY_TV_RELAY.test(cleanName) || (group ? PAY_TV_RELAY.test(group) : false);
  if (ctx.category === 'test-fixture') {
    status = 'test_fixture';
    reasons.push(ctx.reason || 'test fixture');
  } else if (restrictions.indexOf('provider-account-url') >= 0 && ctx.permission !== 'user') {
    // Someone else's paid-IPTV account: the URL itself carries their username and password.
    status = 'restricted';
    keptUrl = null;
    withheld = "Paid IPTV account URL (contains a subscriber's username and password)";
    reasons.push(withheld);
  } else if (paySports && ctx.permission !== 'user') {
    // Pay-TV sports brands are never legitimately free, whichever list carries them (Clearstream rule).
    status = 'restricted';
    keptUrl = null;
    withheld = 'Pay-TV sports channel: never legitimately free (third-party re-stream)';
    reasons.push(withheld);
  } else if (ctx.policy === 'withhold-all' || (ctx.policy === 'withhold-pay' && relayPay)) {
    status = 'restricted';
    keptUrl = null;
    withheld = ctx.policy === 'withhold-all' ? ctx.reason || 'source withheld' : 'Relay of a pay-TV channel (third-party re-stream)';
    reasons.push(withheld);
  } else if (restrictions.some((r) => /^(needs-headers|protocol:|dash|web-page-not-stream)/.test(r))) {
    status = 'unsupported_format';
    for (const r of restrictions) {
      if (r === 'needs-headers') reasons.push('Requires custom User-Agent/Referer headers the TV player cannot send');
      else if (r.indexOf('protocol:') === 0) reasons.push(`Protocol ${r.slice(9)} is not playable on the TV`);
      else if (r === 'dash') reasons.push('MPEG-DASH (not supported by the TV player)');
      else if (r === 'web-page-not-stream') reasons.push('Web page (YouTube/Twitch etc.), not a stream URL');
    }
  } else if (restrictions.indexOf('isp-or-lan-only') >= 0) {
    status = 'requires_provider_access';
    reasons.push('Only reachable inside the originating ISP or local network');
  }
  if (!cleanName) reasons.push('No channel name in the source');

  const meta: RecordMeta = {
    languages,
    languageSource,
    categories,
    labels: title.labels,
    sports,
    restrictions: Array.from(new Set(restrictions)),
  };
  if (tvgId) meta.tvgId = tvgId;
  if (apiChannel) meta.channelId = baseId;
  if (feedId) meta.feed = feedId;
  const logo = e.attrs['tvg-logo'];
  if (logo && /^https?:\/\//i.test(logo)) meta.logo = logo;
  if (group) meta.group = group;
  if (country) meta.country = country;
  if (title.quality) meta.quality = title.quality;
  if (tvgId) meta.epgId = apiChannel ? baseId : tvgId;
  if (football) meta.football = football;
  if (payTvBrand) meta.payTvBrand = true;
  if (e.duration > 0) meta.durationSeconds = e.duration;

  const name = cleanName || (apiChannel ? apiChannel.name : '') || 'Untitled';
  const rec: InventoryRecord = {
    uid: uidOf(ctx.repo, ctx.file, e.line, index),
    kind,
    name,
    url: keptUrl,
    source: { repo: ctx.repo, file: ctx.file, line: e.line, originUrl: ctx.originUrl, permission: ctx.permission, handling: ctx.handling },
    meta,
    importedAt,
    status,
    reasons,
    validation: 'untested',
  };
  if (withheld) rec.urlWithheldReason = withheld;
  if (keptUrl) rec.streamId = streamFingerprint(keptUrl);
  rec.channelKey = apiChannel ? baseId : `n:${slug(canonicalName(name))}|${(country || 'xx').toLowerCase()}`;
  return rec;
}

// ------------------------------------------------------------------ non-playlist sources
function malformed(ctx: SourceCtx, warning: string, importedAt: string, i: number): InventoryRecord {
  const m = /^line (\d+):/.exec(warning);
  const line = m ? Number(m[1]) : 0;
  return {
    uid: uidOf(ctx.repo, ctx.file, line, 100000 + i),
    kind: 'malformed-line',
    name: warning,
    url: null,
    source: { repo: ctx.repo, file: ctx.file, line, originUrl: ctx.originUrl, permission: ctx.permission, handling: ctx.handling },
    meta: { languages: [], languageSource: 'none', categories: [], labels: [], sports: [], restrictions: [] },
    importedAt,
    status: 'malformed',
    reasons: [warning.replace(/^line \d+: /, '')],
    validation: 'untested',
  };
}

function simple(
  kind: RecordKind,
  name: string,
  url: string | null,
  status: RecordStatus,
  reasons: string[],
  src: InventoryRecord['source'],
  importedAt: string,
  extra?: Record<string, unknown>,
  withheld?: string,
): InventoryRecord {
  const r: InventoryRecord = {
    uid: createHash('sha1').update(`${src.repo}|${src.file}|${src.line}|${kind}|${name}`).digest('hex').slice(0, 16),
    kind,
    name,
    url,
    source: src,
    meta: { languages: [], languageSource: 'none', categories: [], labels: [], sports: [], restrictions: [], extra },
    importedAt,
    status,
    reasons,
    validation: 'untested',
  };
  if (withheld) r.urlWithheldReason = withheld;
  return r;
}

/** my-tv's Kotlin channel list: names, aliases, groups and logos (no stream URLs exist). */
export function parseMyTvList(kotlin: string): { name: string; alias: string; group: string; logo: string; line: number }[] {
  const out: { name: string; alias: string; group: string; logo: string; line: number }[] = [];
  const re = /TV\(\s*\d+,\s*"([^"]*)",\s*"([^"]*)",\s*listOf\([^)]*\),\s*"([^"]*)",\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(kotlin))) {
    const line = kotlin.slice(0, m.index).split('\n').length;
    out.push({ name: m[1]!, alias: m[2]!, group: m[3]!, logo: m[4]!, line });
  }
  return out;
}

interface ZhuijuResource {
  id?: string;
  name?: string;
  url?: string;
  category?: string;
  summary_short?: string;
  risks?: { copyright?: string };
}

// ------------------------------------------------------------------ build
export interface InventoryResult {
  records: InventoryRecord[];
  epgSources: { url: string; from: string[] }[];
  errors: { file: string; error: string }[];
}

async function readFile(dir: string, f: ManifestFile): Promise<string> {
  if (f.stored) return readFileSync(join(dir, f.path), 'utf8');
  if (/^https?:\/\//.test(f.origin)) return (await fetchText(f.origin, { timeoutMs: 90000, maxBytes: 80 * 1024 * 1024 })).body; // not cached, not stored
  return gitShow(snapshotDir(dir, f.repo), f.origin).toString('utf8');
}

export async function buildInventory(dir: string, manifest: Manifest, api: ApiIndex | null, log: (m: string) => void, now = new Date().toISOString()): Promise<InventoryResult> {
  const records: InventoryRecord[] = [];
  const errors: { file: string; error: string }[] = [];
  const epg = new Map<string, Set<string>>();
  const addEpg = (url: string, from: string) => {
    const set = epg.get(url) || new Set<string>();
    set.add(from);
    epg.set(url, set);
  };

  for (const f of manifest.files) {
    if (f.status === 'failed' && !f.stored) {
      errors.push({ file: f.origin, error: f.error || 'download failed' });
      continue;
    }
    const ctx: SourceCtx = {
      repo: f.repo,
      file: f.origin,
      originUrl: f.originUrl,
      permission: f.permission,
      handling: f.handling,
      category: f.category,
      policy: f.policy,
      reason: f.reason,
    };
    const src = { repo: f.repo, file: f.origin, line: 0, originUrl: f.originUrl, permission: f.permission, handling: f.handling };
    try {
      if (f.category === 'live-tv' || f.category === 'radio' || f.category === 'test-fixture') {
        const text = await readFile(dir, f);
        const parsed = parsePlaylist(text, { maxEntries: 500000 });
        for (const u of parsed.epgUrls) addEpg(u, `${f.repo}:${f.origin}`);
        parsed.entries.forEach((e, i) => records.push(classifyStream(e, ctx, api, now, i)));
        parsed.warnings.forEach((w, i) => records.push(malformed(ctx, w, now, i)));
      } else if (f.category === 'app-channel-list') {
        const text = await readFile(dir, f);
        for (const c of parseMyTvList(text)) {
          records.push(
            simple('channel-without-url', c.name, null, 'requires_provider_access', [f.reason || 'access-controlled'], { ...src, line: c.line }, now, {
              alias: c.alias,
              group: c.group,
              logo: c.logo,
            }, f.reason),
          );
        }
      } else if (f.category === 'resource-list') {
        const data = JSON.parse(await readFile(dir, f)) as { resources?: ZhuijuResource[] };
        (data.resources || []).forEach((r, i) => {
          const high = !!r.risks && /high/i.test(String(r.risks.copyright));
          const reasons = high ? ['Rated high copyright risk by the repository itself'] : ['Listed resource (not a stream)'];
          records.push(
            simple(
              'website',
              r.name || r.id || `resource ${i + 1}`,
              high ? null : r.url || null,
              high ? 'restricted' : 'reference_only',
              reasons,
              { ...src, line: i + 1 },
              now,
              { category: r.category, summary: r.summary_short, copyrightRisk: r.risks ? r.risks.copyright : undefined },
              high ? 'High copyright risk (piracy)' : undefined,
            ),
          );
        });
      } else if (f.category === 'template') {
        const text = await readFile(dir, f);
        const parsed = parsePlaylist(text);
        parsed.entries.forEach((e, i) => records.push(classifyStream(e, ctx, api, now, i)));
        // Template channel names without URLs (e.g. demo.txt) are recorded as names only.
        text.split(/\r?\n/).forEach((line, i) => {
          const t = line.trim();
          if (!t || t.charAt(0) === '#' || t.charAt(0) === '[' || /,#genre#$/.test(t) || /https?:\/\//.test(t)) return;
          records.push(simple('template', t.split(',')[0]!, null, 'reference_only', ['Channel template / alias entry (no URL in the source)'], { ...src, line: i + 1 }, now));
        });
      } else if (f.category === 'metadata' && /epg\.txt$/i.test(f.origin)) {
        const text = await readFile(dir, f);
        for (const u of text.split(/\r?\n/).map((x) => x.trim()).filter((x) => /^https?:\/\//.test(x))) addEpg(u, `${f.repo}:${f.origin}`);
      } else if (f.category === 'epg') {
        addEpg(f.path, `${f.repo}:${f.origin} (local copy)`);
      }
    } catch (err) {
      const message = (err as Error).message.split('\n')[0]!;
      errors.push({ file: `${f.repo}:${f.origin}`, error: message });
      log(`inventory: ${f.repo}:${f.origin} FAILED ${message}`);
    }
  }

  // Your own M3U profiles (copied to generated/profiles/ by providers.ts).
  for (const prof of loadProfiles(dir).profiles) {
    if (prof.type !== 'm3u' || !prof.enabled) continue;
    const file = join(dir, 'generated/profiles', `${prof.id}.m3u`);
    if (!existsSync(file)) continue;
    const ctx: SourceCtx = { repo: `profile:${prof.id}`, file: prof.id, originUrl: prof.url || prof.file || '', permission: 'user', handling: 'copy', category: 'live-tv', policy: 'keep' };
    const parsed = parsePlaylist(readFileSync(file, 'utf8'), { maxEntries: 500000 });
    parsed.entries.forEach((e, i) => {
      const r = classifyStream(e, ctx, api, now, i);
      if (prof.contentType === 'vod-movies' || prof.contentType === 'vod-series') r.kind = 'vod';
      if (!r.meta.languages.length && prof.languages && prof.languages.length) {
        r.meta.languages = prof.languages.slice();
        r.meta.languageSource = 'profile';
      }
      records.push(r);
    });
    parsed.warnings.forEach((w, i) => records.push(malformed(ctx, w, now, i)));
  }

  // Internet Archive public-domain films and TV (resolved by archive.ts). Items whose
  // public-domain mark is not credible are recorded without a link, with the reason.
  const ia = readArchive(dir);
  if (ia) {
    for (const item of ia.items) {
      const src = { repo: 'internet-archive', file: item.set, line: 0, originUrl: `https://archive.org/details/${item.id}`, permission: 'open' as const, handling: 'reference' as const };
      const series = item.kind === 'tv' || item.files.length > 1;
      item.files.forEach((f, i) => {
        const episode = f.title || f.name.replace(/\.(ia\.)?mp4$/i, '').replace(/[_]+/g, ' ');
        const url = `https://archive.org/download/${encodeURIComponent(item.id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`;
        const r = simple('vod', series ? `${item.title} — ${episode}` : item.title, url, 'imported', [`Marked public domain on the Internet Archive (${item.licenseurl})`], { ...src, line: i }, now, {
          vodType: series ? 'episode' : 'movie',
          series: series ? item.title : undefined,
          episode: series ? episode : undefined,
          episodeNo: series ? i + 1 : undefined,
          genre: item.genre,
          year: item.year,
          archiveId: item.id,
        });
        r.meta.languages = [item.language];
        r.meta.languageSource = 'archive';
        r.meta.group = series ? item.title : item.genre;
        r.meta.logo = `https://archive.org/services/img/${encodeURIComponent(item.id)}`;
        if (f.length) r.meta.durationSeconds = f.length;
        records.push(r);
      });
    }
    ia.excluded.forEach((x, i) => {
      records.push(
        simple('vod', x.title || x.id, null, 'restricted', [`Marked public domain by its uploader, but ${x.reason}`], { repo: 'internet-archive', file: x.set, line: i, originUrl: `https://archive.org/details/${x.id}`, permission: 'unclear', handling: 'reference' }, now, undefined, 'public-domain mark not credible'),
      );
    });
  }

  // Provider adapters found in iptvnator (and supported by FBTV's library tool where marked).
  const nator = { repo: 'iptvnator', file: 'libs/portal', line: 0, originUrl: 'https://github.com/4gray/iptvnator', permission: 'open' as const, handling: 'reference' as const };
  records.push(simple('provider-adapter', 'Xtream Codes API (player_api.php)', null, 'requires_provider_access', ['Needs your own provider account'], { ...nator, file: 'libs/portal/xtream/data-access/src/client.ts' }, now, { supportedByFbtv: true }));
  records.push(simple('provider-adapter', 'Stalker / Ministra portal', null, 'requires_provider_access', ['Needs your own portal subscription (MAC identity)'], { ...nator, file: 'libs/portal/stalker/data-access/src/client.ts' }, now, { supportedByFbtv: false }));
  records.push(simple('provider-adapter', 'M3U / M3U8 playlists (file or URL)', null, 'reference_only', ['Supported through provider profiles'], { ...nator, file: 'apps/electron-backend/src/app/events/playlist-source.ts' }, now, { supportedByFbtv: true }));

  // Recorded references (nothing fetched).
  for (const repo of REPOS) {
    for (const ref of repo.references || []) {
      records.push(simple('reference', ref.url, ref.url, 'reference_only', [ref.reason], { repo: repo.id, file: '(references)', line: 0, originUrl: repo.url, permission: 'n/a', handling: 'n/a' }, now));
    }
  }

  const epgSources = Array.from(epg.entries()).map(([url, from]) => ({ url, from: Array.from(from) }));
  for (const e of epgSources) {
    records.push(simple('epg-source', e.url, e.url, 'reference_only', [`Guide URL advertised by ${e.from.length} source file(s)`], { repo: e.from[0]!.split(':')[0]!, file: e.from[0]!, line: 0, originUrl: e.url, permission: 'n/a', handling: 'n/a' }, now, { from: e.from }));
  }

  markDuplicates(records);
  return { records, epgSources, errors };
}

/** Source trust order: the first record of a stream (in this order) is the primary copy. */
const TRUST: Record<string, number> = { 'iptv-org': 0, 'free-tv': 1, 'fanmingming-live': 2, 'tvlist-awesome': 3, 'iptv-sources': 4, 'iptv-api': 5 };

/** Marks later copies of the same stream as duplicate_reference (provenance kept). Pure. */
export function markDuplicates(records: InventoryRecord[]): number {
  const order = records
    .map((r, i) => ({ r, i }))
    .filter((x) => x.r.streamId && x.r.status === 'imported')
    .sort((a, b) => (TRUST[a.r.source.repo] ?? 9) - (TRUST[b.r.source.repo] ?? 9) || a.i - b.i);
  const first = new Map<string, string>();
  let dups = 0;
  for (const { r } of order) {
    const prev = first.get(r.streamId!);
    if (prev) {
      r.status = 'duplicate_reference';
      r.duplicateOf = prev;
      r.reasons.push('Same stream as an earlier record (kept as an alternative source reference)');
      dups++;
    } else first.set(r.streamId!, r.uid);
  }
  return dups;
}

export function writeInventory(dir: string, records: InventoryRecord[]): void {
  const lines: string[] = [];
  for (const r of records) lines.push(JSON.stringify(r));
  writeFileSync(join(dir, 'catalogs/inventory.jsonl'), lines.join('\n') + '\n');
}

export function readInventory(dir: string): InventoryRecord[] {
  const p = join(dir, 'catalogs/inventory.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as InventoryRecord);
}

