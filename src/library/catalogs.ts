/**
 * Derived views over the inventory: normalised channels (every alternative stream kept with
 * its provenance), sports and football catalogs, VOD catalogs (Layer A: everything; Layer B:
 * English / Hindi / Bengali), generated M3U playlists and the source registry that the app's
 * dropdowns are built from. Nothing here deletes inventory records.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fold, normalizeLanguages } from '../shared/normalize.ts';
import { logoUsable } from '../shared/url.ts';
import type { InventoryRecord, RecordStatus, ValidationStatus } from './inventory.ts';
import { SPORTS, type FootballRole } from './policy.ts';
import type { Fixture, FixtureResult } from './fixtures.ts';
import { linkRights, loadRights, type CompetitionRights, type LinkableChannel } from './broadcasters.ts';
import { loadProfiles, type Profile } from './profiles.ts';
import { hasCredentials } from './secrets.ts';
import type { SeriesItem, VodItem, XtreamCapabilities } from './xtream.ts';

export const TARGET_VOD_LANGUAGES = ['eng', 'hin', 'ben'];
export const LANG_LABEL: Record<string, string> = { eng: 'English', hin: 'Hindi', ben: 'Bengali / Bangla' };

// ------------------------------------------------------------------ status db
export interface StatusRecord {
  checkedAt: string;
  reachable: boolean;
  httpStatus?: number;
  contentKind?: string;
  error?: string;
  playable?: boolean;
  playableCheckedAt?: string;
  width?: number;
  height?: number;
}
export type StatusDb = Record<string, StatusRecord>;

export function validationOf(s: StatusRecord | undefined): ValidationStatus {
  if (!s) return 'untested';
  if (s.playable === true) return 'playback_confirmed';
  if (s.playable === false) return 'playback_failed';
  return s.reachable ? 'reachable' : 'temporarily_unavailable';
}

// ------------------------------------------------------------------ channels
export interface CatalogStream {
  id: string;
  url: string;
  status: RecordStatus;
  reasons: string[];
  restrictions: string[];
  quality?: string;
  feed?: string;
  languages: string[];
  validation: ValidationStatus;
  measured?: { width: number; height: number };
  sources: { uid: string; repo: string; file: string; line: number; permission: string }[];
}

export interface CatalogChannel {
  id: string;
  kind: 'stream' | 'radio';
  name: string;
  altNames: string[];
  country?: string;
  languages: string[];
  languageSource: string;
  categories: string[];
  groups: string[];
  logo?: string;
  epgId?: string;
  sports: string[];
  football?: FootballRole;
  payTvBrand: boolean;
  /** At least one stream the TV player can attempt (imported or duplicate reference). */
  playable: boolean;
  streams: CatalogStream[];
  repos: string[];
}

const STATUS_RANK: Record<string, number> = { imported: 0, duplicate_reference: 1, requires_provider_access: 2, unsupported_format: 3 };
const VALID_RANK: Record<ValidationStatus, number> = { playback_confirmed: 0, reachable: 1, untested: 2, playback_failed: 3, temporarily_unavailable: 4 };
const TRUST: Record<string, number> = { 'iptv-org': 0, 'free-tv': 1, 'fanmingming-live': 2, 'tvlist-awesome': 3, 'iptv-sources': 4, 'iptv-api': 5 };
const ROLE_RANK: Record<FootballRole, number> = { dedicated: 0, club: 1, 'broadcaster-brand': 2 };

export function buildChannels(records: InventoryRecord[], status: StatusDb): CatalogChannel[] {
  const byKey = new Map<string, { recs: InventoryRecord[] }>();
  for (const r of records) {
    if ((r.kind !== 'stream' && r.kind !== 'radio') || !r.url || !r.channelKey) continue;
    if (STATUS_RANK[r.status] === undefined) continue; // restricted / malformed / fixtures live only in the inventory
    const g = byKey.get(r.channelKey);
    if (g) g.recs.push(r);
    else byKey.set(r.channelKey, { recs: [r] });
  }
  const out: CatalogChannel[] = [];
  byKey.forEach(({ recs }, key) => {
    recs.sort((a, b) => (TRUST[a.source.repo] ?? 9) - (TRUST[b.source.repo] ?? 9));
    const head = recs[0]!;
    const streams = new Map<string, CatalogStream>();
    for (const r of recs) {
      const id = r.streamId!;
      const src = { uid: r.uid, repo: r.source.repo, file: r.source.file, line: r.source.line, permission: String(r.source.permission) };
      const s = streams.get(id);
      if (s) {
        s.sources.push(src);
        if (STATUS_RANK[r.status]! < STATUS_RANK[s.status]!) s.status = r.status;
        continue;
      }
      const st = status[id];
      const cs: CatalogStream = {
        id,
        url: r.url!,
        status: r.status,
        reasons: r.reasons,
        restrictions: r.meta.restrictions,
        languages: r.meta.languages,
        validation: validationOf(st),
        sources: [src],
      };
      if (r.meta.quality) cs.quality = r.meta.quality;
      if (r.meta.feed) cs.feed = r.meta.feed;
      if (st && st.width && st.height) cs.measured = { width: st.width, height: st.height };
      streams.set(id, cs);
    }
    const list = Array.from(streams.values()).sort(
      (a, b) =>
        STATUS_RANK[a.status]! - STATUS_RANK[b.status]! ||
        VALID_RANK[a.validation] - VALID_RANK[b.validation] ||
        (TRUST[a.sources[0]!.repo] ?? 9) - (TRUST[b.sources[0]!.repo] ?? 9) ||
        (parseInt(b.quality || '0', 10) || 0) - (parseInt(a.quality || '0', 10) || 0),
    );
    const names = new Set<string>();
    const langs: string[] = [];
    const cats: string[] = [];
    const groups: string[] = [];
    const sports: string[] = [];
    let football: FootballRole | undefined;
    let logo: string | undefined;
    let country: string | undefined;
    let epgId: string | undefined;
    let payTv = false;
    for (const r of recs) {
      names.add(r.name);
      for (const l of r.meta.languages) if (langs.indexOf(l) < 0) langs.push(l);
      for (const c of r.meta.categories) if (cats.indexOf(c) < 0) cats.push(c);
      if (r.meta.group && groups.indexOf(r.meta.group) < 0) groups.push(r.meta.group);
      for (const s of r.meta.sports) if (sports.indexOf(s) < 0) sports.push(s);
      if (r.meta.football && (!football || ROLE_RANK[r.meta.football] < ROLE_RANK[football])) football = r.meta.football;
      if (!logo && logoUsable(r.meta.logo)) logo = r.meta.logo;
      if (!country && r.meta.country) country = r.meta.country;
      if (!epgId && r.meta.epgId) epgId = r.meta.epgId;
      if (r.meta.payTvBrand) payTv = true;
    }
    names.delete(head.name);
    const ch: CatalogChannel = {
      id: key,
      kind: head.kind === 'radio' ? 'radio' : 'stream',
      name: head.name,
      altNames: Array.from(names).slice(0, 12),
      languages: langs,
      languageSource: head.meta.languageSource,
      categories: cats,
      groups: groups.slice(0, 8),
      sports,
      payTvBrand: payTv,
      playable: list.some((s) => s.status === 'imported' || s.status === 'duplicate_reference'),
      streams: list,
      repos: Array.from(new Set(recs.map((r) => r.source.repo))),
    };
    if (country) ch.country = country;
    if (logo) ch.logo = logo;
    if (epgId) ch.epgId = epgId;
    if (football) ch.football = football;
    out.push(ch);
  });
  out.sort((a, b) => (fold(a.name) < fold(b.name) ? -1 : 1));
  return out;
}

// ------------------------------------------------------------------ M3U
export function bestStream(c: CatalogChannel): CatalogStream | undefined {
  return c.streams.filter((s) => s.status === 'imported' || s.status === 'duplicate_reference')[0];
}

export function toM3U(channels: CatalogChannel[], title: string): string {
  const lines = ['#EXTM3U', `# ${title} — generated by the FBTV library; provenance in catalogs/channels.json`];
  for (const c of channels) {
    const s = bestStream(c);
    if (!s) continue;
    const attrs: string[] = [];
    const q = (v: string) => v.replace(/"/g, "'");
    if (c.epgId) attrs.push(`tvg-id="${q(c.epgId)}"`);
    attrs.push(`tvg-name="${q(c.name)}"`);
    if (c.logo) attrs.push(`tvg-logo="${q(c.logo)}"`);
    if (c.country) attrs.push(`tvg-country="${c.country}"`);
    if (c.languages.length) attrs.push(`tvg-language="${c.languages.join(';')}"`);
    const group = c.categories[0] || c.groups[0] || '';
    if (group) attrs.push(`group-title="${q(group)}"`);
    lines.push(`#EXTINF:-1 ${attrs.join(' ')},${c.name.replace(/[\r\n,]/g, ' ')}`);
    lines.push(s.url);
  }
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------ registry
export interface RegistryItem {
  id: string;
  name: string;
  group: string;
  type: 'm3u' | 'xtream' | 'catalog' | 'api';
  contentType: 'live' | 'sports' | 'football' | 'news' | 'radio' | 'vod-movies' | 'vod-series' | 'vod-review' | 'fixtures' | 'epg' | 'mixed';
  languages: string[];
  path?: string;
  url?: string;
  profileRef?: string;
  attribution: { repo: string; channels: number }[];
  channels: number;
  lastRefresh: string;
  importStatus: 'imported' | 'empty' | 'needs-credentials' | 'needs-setup' | 'error';
  validation: { checked: number; reachable: number; playbackConfirmed: number; untested: number };
  note?: string;
  error?: string;
}

export interface Registry {
  schema: 2;
  generatedAt: string;
  dataDir: string;
  groups: string[];
  items: RegistryItem[];
}

function write(p: string, data: unknown): void {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, typeof data === 'string' ? data : JSON.stringify(data));
}

function readJSON<T>(p: string, fallback: T): T {
  try {
    return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
  } catch {
    return fallback;
  }
}

function summary(channels: CatalogChannel[]) {
  let checked = 0;
  let reachable = 0;
  let confirmed = 0;
  let untested = 0;
  for (const c of channels) {
    const s = bestStream(c);
    if (!s) continue;
    if (s.validation === 'untested') untested++;
    else checked++;
    if (s.validation === 'reachable' || s.validation === 'playback_confirmed') reachable++;
    if (s.validation === 'playback_confirmed') confirmed++;
  }
  return { checked, reachable, playbackConfirmed: confirmed, untested };
}

function attribution(channels: CatalogChannel[]) {
  const m = new Map<string, number>();
  for (const c of channels) for (const r of c.repos) m.set(r, (m.get(r) || 0) + 1);
  return Array.from(m.entries())
    .map(([repo, n]) => ({ repo, channels: n }))
    .sort((a, b) => b.channels - a.channels);
}

const has = (l: string[] | undefined, v: string) => !!l && l.indexOf(v) >= 0;

/** News-list membership (category or group name). Exported so the TV export applies the same rule. */
export function isNews(c: CatalogChannel): boolean {
  return has(c.categories, 'news') || c.groups.some((g) => /\bnews|新闻|新聞|أخبار/i.test(g));
}

/** Sports-list membership (sport tag, category or group name). */
export function isSports(c: CatalogChannel): boolean {
  return !!c.sports.length || has(c.categories, 'sports') || c.groups.some((g) => /\bsport|体育|體育|رياض/i.test(g));
}

const safe =(s: string) => fold(s).replace(/\s+/g, '-').slice(0, 60) || 'unknown';

// ------------------------------------------------------------------ main
export interface CatalogsResult {
  channels: CatalogChannel[];
  registry: Registry;
  vod: { inventory: number; byLanguage: Record<string, { movies: number; series: number; episodes: number }>; unknown: number; other: number };
}

export function buildCatalogs(dir: string, records: InventoryRecord[], fixtures: FixtureResult | null, now = new Date().toISOString(), log: (m: string) => void = () => undefined): CatalogsResult {
  const status = readJSON<StatusDb>(join(dir, 'catalogs/source-status.json'), {});
  for (const r of records) if (r.streamId) r.validation = validationOf(status[r.streamId]);
  const channels = buildChannels(records, status);
  const live = channels.filter((c) => c.kind === 'stream');
  const items: RegistryItem[] = [];
  const countryNames = new Map<string, string>();
  for (const c of readJSON<{ code: string; name: string }[]>(join(dir, 'repositories/iptv-org/api/countries.json'), [])) countryNames.set(c.code, c.name);
  const langNames = new Map<string, string>();
  for (const l of readJSON<{ code: string; name: string }[]>(join(dir, 'repositories/iptv-org/api/languages.json'), [])) langNames.set(l.code, l.name);

  const writtenPlaylists = new Set<string>();
  const addList = (id: string, name: string, group: string, contentType: RegistryItem['contentType'], languages: string[], list: CatalogChannel[], rel: string, note?: string) => {
    write(join(dir, rel), toM3U(list, name));
    writtenPlaylists.add(rel);
    const playable = list.filter((c) => c.playable);
    items.push({
      id,
      name,
      group,
      type: 'm3u',
      contentType,
      languages,
      path: rel,
      attribution: attribution(list),
      channels: playable.length,
      lastRefresh: now,
      importStatus: playable.length ? 'imported' : 'empty',
      validation: summary(playable),
      note: note || (list.length > playable.length ? `plus ${list.length - playable.length} listed as unavailable (no stream the TV can attempt)` : undefined),
    });
  };

  // ---- Live TV
  addList('live-all', 'All Live TV', 'Live TV', 'live', [], live, 'playlists/live-tv/all.m3u');
  const byCountry = new Map<string, CatalogChannel[]>();
  const byLang = new Map<string, CatalogChannel[]>();
  const byCat = new Map<string, CatalogChannel[]>();
  const byRepo = new Map<string, CatalogChannel[]>();
  const push = (m: Map<string, CatalogChannel[]>, k: string, c: CatalogChannel) => {
    const a = m.get(k);
    if (a) a.push(c);
    else m.set(k, [c]);
  };
  for (const c of live) {
    push(byCountry, c.country || 'unknown', c);
    if (c.languages.length) for (const l of c.languages) push(byLang, l, c);
    else push(byLang, 'unknown', c);
    if (c.categories.length) for (const g of c.categories) push(byCat, g, c);
    else push(byCat, 'uncategorised', c);
    for (const r of c.repos) push(byRepo, r, c);
  }
  const sortedKeys = (m: Map<string, CatalogChannel[]>) => Array.from(m.keys()).sort((a, b) => m.get(b)!.length - m.get(a)!.length);
  for (const k of sortedKeys(byCountry)) {
    const nm = k === 'unknown' ? 'Country unknown' : countryNames.get(k) || k;
    addList(`country-${k.toLowerCase()}`, nm, 'Live TV › Countries', 'live', [], byCountry.get(k)!, `playlists/live-tv/countries/${k.toLowerCase()}.m3u`);
  }
  for (const k of sortedKeys(byLang)) {
    const nm = k === 'unknown' ? 'Language unknown' : langNames.get(k) || k;
    addList(`language-${k}`, nm, 'Live TV › Languages', 'live', k === 'unknown' ? [] : [k], byLang.get(k)!, `playlists/live-tv/languages/${k}.m3u`);
  }
  for (const k of sortedKeys(byCat)) addList(`category-${k}`, k.charAt(0).toUpperCase() + k.slice(1), 'Live TV › Categories', 'live', [], byCat.get(k)!, `playlists/live-tv/categories/${safe(k)}.m3u`);
  for (const k of sortedKeys(byRepo)) addList(`source-${k}`, `From ${k}`, 'Live TV › Sources', 'live', [], byRepo.get(k)!, `playlists/live-tv/sources/${k}.m3u`);
  addList('movie-channels', 'Movie channels (24/7, not on demand)', 'Live TV', 'live', [], live.filter((c) => has(c.categories, 'movies')), 'playlists/live-tv/movie-channels.m3u', 'Linear channels that broadcast films. Not an on-demand catalogue.');
  addList('series-channels', 'Series channels (24/7, not on demand)', 'Live TV', 'live', [], live.filter((c) => has(c.categories, 'series')), 'playlists/live-tv/series-channels.m3u', 'Linear channels that broadcast series. Not an on-demand catalogue.');

  // ---- News
  const news = live.filter(isNews);
  addList('news-all', 'News — all', 'News', 'news', [], news, 'playlists/news/all.m3u');
  addList('news-english', 'English News', 'News', 'news', ['eng'], news.filter((c) => has(c.languages, 'eng')), 'playlists/news/english.m3u');
  addList('news-uk', 'UK News', 'News', 'news', [], news.filter((c) => c.country === 'UK'), 'playlists/news/uk.m3u');
  addList('news-arabic', 'Arabic News', 'News', 'news', ['ara'], news.filter((c) => has(c.languages, 'ara')), 'playlists/news/arabic.m3u');

  // ---- Sports
  const sports = live.filter(isSports);
  addList('sports-all', 'Sports — all channels', 'Sports', 'sports', [], sports, 'playlists/sports/all.m3u');
  addList('sports-english', 'Sports — English', 'Sports', 'sports', ['eng'], sports.filter((c) => has(c.languages, 'eng')), 'playlists/sports/english.m3u');
  addList('sports-arabic', 'Sports — Arabic', 'Sports', 'sports', ['ara'], sports.filter((c) => has(c.languages, 'ara')), 'playlists/sports/arabic.m3u');
  addList('sports-other-languages', 'Sports — other languages', 'Sports', 'sports', [], sports.filter((c) => !has(c.languages, 'eng') && !has(c.languages, 'ara')), 'playlists/sports/other-languages.m3u');
  const sportsCatalog: { id: string; name: string; channels: { id: string; name: string; country?: string; languages: string[]; playable: boolean }[] }[] = [];
  for (const sp of SPORTS) {
    const list = sports.filter((c) => has(c.sports, sp.id));
    sportsCatalog.push({ id: sp.id, name: sp.name, channels: list.map((c) => ({ id: c.id, name: c.name, country: c.country, languages: c.languages, playable: c.playable })) });
    if (sp.id !== 'football') addList(`sport-${sp.id}`, sp.name, 'Sports › By sport', 'sports', [], list, `playlists/sports/${sp.id}.m3u`, 'Classified from channel names, groups and categories');
  }
  const untagged = sports.filter((c) => !c.sports.length);
  sportsCatalog.push({ id: 'general', name: 'Multi-sport & general', channels: untagged.map((c) => ({ id: c.id, name: c.name, country: c.country, languages: c.languages, playable: c.playable })) });
  addList('sport-general', 'Multi-sport & general', 'Sports › By sport', 'sports', [], untagged, 'playlists/sports/general.m3u');

  // ---- Football
  const football = live.filter((c) => c.football || has(c.sports, 'football'));
  addList('football-all', 'Football — all channels', 'Football', 'football', [], football, 'playlists/football/all.m3u', 'No channel is assumed to show any particular match');
  addList('football-dedicated', 'Football — dedicated & league channels', 'Football', 'football', [], football.filter((c) => c.football === 'dedicated'), 'playlists/football/dedicated.m3u');
  addList('football-clubs', 'Football — club TV', 'Football', 'football', [], football.filter((c) => c.football === 'club'), 'playlists/football/club-tv.m3u');
  addList('football-broadcasters', 'Football — broadcaster brands (rights vary)', 'Football', 'football', [], football.filter((c) => c.football === 'broadcaster-brand'), 'playlists/football/broadcasters.m3u', 'Brands that hold football rights in some markets; rights vary by country and season');
  addList('football-english', 'Football — English (broadcast language)', 'Football', 'football', ['eng'], football.filter((c) => has(c.languages, 'eng')), 'playlists/football/english.m3u', 'Language from feed metadata; commentary language not verified');
  addList('football-arabic', 'Football — Arabic (broadcast language)', 'Football', 'football', ['ara'], football.filter((c) => has(c.languages, 'ara')), 'playlists/football/arabic.m3u', 'Language from feed metadata; commentary language not verified');

  // ---- Other playlists
  addList('radio', 'Radio', 'Radio', 'radio', [], channels.filter((c) => c.kind === 'radio'), 'playlists/combined/radio.m3u');
  addList('reachable', 'Reachable at last check', 'Status', 'live', [], live.filter((c) => { const s = bestStream(c); return !!s && (s.validation === 'reachable' || s.validation === 'playback_confirmed'); }), 'playlists/combined/reachable.m3u');
  addList('playback-confirmed', 'Playback confirmed (ffprobe)', 'Status', 'live', [], live.filter((c) => { const s = bestStream(c); return !!s && s.validation === 'playback_confirmed'; }), 'playlists/combined/playback-confirmed.m3u');

  // ---- catalogs
  write(join(dir, 'catalogs/channels.json'), { generatedAt: now, count: channels.length, playable: channels.filter((c) => c.playable).length, channels });
  // Football: channels + fixtures + listing-based name matches (never assumed to carry a match).
  const normName = (s: string) => fold(s).replace(/\b(hd|fhd|uhd|sd|tv|channel)\b/g, ' ').replace(/\s+/g, ' ').trim();
  const index = new Map<string, CatalogChannel[]>();
  for (const c of live) {
    for (const n of [c.name].concat(c.altNames)) {
      const k = normName(n);
      if (!k) continue;
      const a = index.get(k);
      if (a) a.push(c);
      else index.set(k, [c]);
    }
  }
  // Broadcast rights per competition and country, linked to library channels of the same name.
  const rights = new Map<string, CompetitionRights>();
  for (const [id, r] of loadRights(log)) rights.set(id, linkRights(r, index as Map<string, LinkableChannel[]>, normName));
  const withRights = <T extends { id: string }>(c: T) => (rights.has(c.id) ? { ...c, rights: rights.get(c.id) } : c);
  write(join(dir, 'catalogs/sports.json'), {
    generatedAt: now,
    note: 'Sport tags come from channel names, groups and categories (heuristic, shown so you can correct them in overrides). Events are schedule data, not broadcasts. Rights holders are researched per competition and country, with sources.',
    sports: sportsCatalog,
    events: fixtures ? fixtures.fixtures.filter((f) => f.sport !== 'football') : [],
    competitions: fixtures ? fixtures.competitions.filter((c) => c.sport !== 'football').map(withRights) : [],
  });
  const footballFixtures = fixtures ? fixtures.fixtures.filter((f) => f.sport === 'football') : [];
  const associations = footballFixtures
    .filter((f) => f.broadcasts.length)
    .map((f) => ({
      fixture: f.id,
      listed: f.broadcasts,
      nameMatches: f.broadcasts
        .map((b) => ({ listing: b.channel, country: b.country, channels: (index.get(normName(b.channel)) || []).map((c) => ({ id: c.id, name: c.name, playable: c.playable })) }))
        .filter((m) => m.channels.length),
      status: 'listing-name-match-unverified',
    }));
  write(join(dir, 'catalogs/football.json'), {
    generatedAt: now,
    notes: [
      'Channel roles: dedicated (football/league channels), club (club TV), broadcaster-brand (holds football rights in some markets).',
      'Language is the feed’s broadcast language from source metadata; commentary language is not verified.',
      'Associations come only from TheSportsDB TV listings matched to channel names. They are unverified and never mean a stream carries the match.',
      'Rights holders (competitions[].rights) say who may show a competition in each country, researched from official sources; which channel shows a given match varies. A library link means a channel of that name in that country has a public stream; pay-TV relays are never linked.',
    ],
    channels: football.map((c) => ({
      id: c.id,
      name: c.name,
      role: c.football || 'tagged-by-name',
      country: c.country,
      languages: c.languages,
      epgId: c.epgId,
      playable: c.playable,
      payTvBrand: c.payTvBrand,
      streams: c.streams.map((s) => ({ url: s.url, status: s.status, validation: s.validation, quality: s.quality, restrictions: s.restrictions, sources: s.sources.map((x) => `${x.repo}:${x.file}#${x.line}`) })),
    })),
    competitions: fixtures ? fixtures.competitions.filter((c) => c.sport === 'football').map(withRights) : [],
    fixtures: footballFixtures,
    associations,
  });

  // ---- VOD (Layer A: inventory of every VOD record; Layer B: target languages)
  const vodRecords = records.filter((r) => r.kind === 'vod');
  const episodeRe = /\bS(\d{1,2})\s*E(\d{1,3})\b|\bseason\s*(\d+).*episode\s*(\d+)/i;
  const ex = (r: InventoryRecord, k: string) => (r.meta.extra ? (r.meta.extra[k] as string | number | undefined) : undefined);
  const vodInventory = vodRecords.map((r) => ({
    uid: r.uid,
    title: r.name,
    url: r.url,
    status: r.status,
    reasons: r.reasons,
    type: ex(r, 'vodType') === 'episode' || episodeRe.test(r.name) ? 'episode' : ex(r, 'vodType') === 'movie' ? 'movie' : 'movie-or-unknown',
    series: ex(r, 'series') as string | undefined,
    episode: ex(r, 'episode') as string | undefined,
    episodeNo: ex(r, 'episodeNo') as number | undefined,
    genre: ex(r, 'genre') as string | undefined,
    year: ex(r, 'year') as number | undefined,
    languages: r.meta.languages,
    languageEvidence: r.meta.languageSource,
    group: r.meta.group,
    poster: r.meta.logo,
    durationSeconds: r.meta.durationSeconds,
    source: `${r.source.repo}:${r.source.file}#${r.source.line}`,
    validation: r.validation,
  }));
  const { profiles, problems } = loadProfiles(dir);
  const providerVod: VodItem[] = [];
  const providerSeries: SeriesItem[] = [];
  for (const p of profiles) {
    if (p.type !== 'xtream') continue;
    providerVod.push(...readJSON<VodItem[]>(join(dir, `generated/xtream/${p.id}/vod.json`), []));
    providerSeries.push(...readJSON<SeriesItem[]>(join(dir, `generated/xtream/${p.id}/series.json`), []));
  }
  const target = (langs: string[]) => normalizeLanguages(langs).some((l) => TARGET_VOD_LANGUAGES.indexOf(l) >= 0);
  const known = (langs: string[]) => normalizeLanguages(langs).length > 0;
  const moviesB = vodInventory.filter((v) => v.type !== 'episode' && target(v.languages)).concat(providerVod.filter((v) => target(v.languages)) as never[]);
  const episodesB = vodInventory.filter((v) => v.type === 'episode' && target(v.languages));
  // Series assembled from episode records that name their series (Internet Archive items).
  const assembled = new Map<string, { title: string; seriesId: string; source: string; languages: string[]; poster?: string; genre?: string; year?: number; seasons: { season: number; episodes: { episode: number; title: string; url: string | null; durationSeconds?: number; status: string }[] }[] }>();
  for (const v of vodInventory) {
    if (v.type !== 'episode' || !v.series || !target(v.languages) || v.status !== 'imported') continue;
    const key = `${v.source.split(':')[0]}|${v.series}`;
    let s = assembled.get(key);
    if (!s) {
      s = { title: v.series, seriesId: key, source: v.source.split(':')[0]!, languages: v.languages, poster: v.poster, genre: v.genre, year: v.year, seasons: [{ season: 1, episodes: [] }] };
      assembled.set(key, s);
    }
    s.seasons[0]!.episodes.push({ episode: v.episodeNo || s.seasons[0]!.episodes.length + 1, title: v.episode || v.title, url: v.url, durationSeconds: v.durationSeconds, status: v.status });
  }
  const seriesB = (providerSeries.filter((s) => target(s.languages)) as unknown[]).concat(Array.from(assembled.values())) as SeriesItem[];
  const unknownLang = vodInventory.filter((v) => !known(v.languages)).length + providerVod.filter((v) => !known(v.languages)).length + providerSeries.filter((v) => !known(v.languages)).length;
  const otherLang = vodInventory.filter((v) => known(v.languages) && !target(v.languages)).length + providerVod.filter((v) => known(v.languages) && !target(v.languages)).length;
  write(join(dir, 'catalogs/vod-inventory.json'), {
    generatedAt: now,
    note: 'Layer A: every on-demand record discovered (positive duration or direct media file), any language, with language evidence. Linear channels are never here.',
    playlistItems: vodInventory,
    providerMovies: providerVod,
    providerSeries,
  });
  write(join(dir, 'catalogs/movies.json'), { generatedAt: now, note: 'Layer B: on-demand films in English, Hindi or Bengali (by language metadata).', items: moviesB });
  write(join(dir, 'catalogs/series.json'), { generatedAt: now, note: 'Layer B: on-demand series in English, Hindi or Bengali, with seasons/episodes when the provider supplies them.', items: seriesB });
  write(join(dir, 'catalogs/episodes.json'), {
    generatedAt: now,
    note: 'Layer B: individual episodes in English, Hindi or Bengali.',
    items: episodesB.concat(
      seriesB.flatMap((s) =>
        (s.seasons || []).flatMap((se) => se.episodes.map((e) => ({ series: s.title, seriesId: s.seriesId, profile: s.profile, season: se.season, episode: e.episode, title: e.title, episodeId: e.episodeId, languages: s.languages }))),
      ) as never[],
    ),
  });
  write(join(dir, 'catalogs/vod-language-review.json'), {
    generatedAt: now,
    note: 'On-demand items whose language is not established by metadata. Classify them (profile categoryLanguages or overrides); they are not shown as English/Hindi/Bengali until then.',
    items: vodInventory.filter((v) => !known(v.languages)).concat(providerVod.filter((v) => !known(v.languages)) as never[], providerSeries.filter((v) => !known(v.languages)) as never[]),
  });
  const byLanguage: CatalogsResult['vod']['byLanguage'] = {};
  for (const l of TARGET_VOD_LANGUAGES) {
    const movies = moviesB.filter((m) => normalizeLanguages((m as { languages: string[] }).languages).indexOf(l) >= 0);
    const series = seriesB.filter((s) => s.languages.indexOf(l) >= 0);
    const episodes = episodesB.filter((e) => normalizeLanguages(e.languages).indexOf(l) >= 0).length + series.reduce((n, s) => n + (s.seasons || []).reduce((m, x) => m + x.episodes.length, 0), 0);
    byLanguage[l] = { movies: movies.length, series: series.length, episodes };
    const why = `None of the collected sources contain on-demand ${LANG_LABEL[l]} titles. Add an Xtream or VOD M3U profile you are authorised to use.`;
    for (const [kind, n, label, file] of [
      ['vod-movies', movies.length, 'Movies VOD', 'catalogs/movies.json'],
      ['vod-series', series.length, 'Series VOD', 'catalogs/series.json'],
    ] as const) {
      items.push({
        id: `${kind}-${l}`,
        name: `${label} — ${LANG_LABEL[l]}`,
        group: label,
        type: 'catalog',
        contentType: kind,
        languages: [l],
        path: file,
        attribution: [],
        channels: n,
        lastRefresh: now,
        importStatus: n ? 'imported' : 'needs-setup',
        validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: n },
        error: n ? undefined : why,
      });
    }
  }
  items.push({
    id: 'vod-review',
    name: 'VOD — language to review',
    group: 'Movies VOD',
    type: 'catalog',
    contentType: 'vod-review',
    languages: [],
    path: 'catalogs/vod-language-review.json',
    attribution: [],
    channels: unknownLang,
    lastRefresh: now,
    importStatus: unknownLang ? 'imported' : 'empty',
    validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: unknownLang },
    note: 'Not shown in Movies/Series until classified.',
  });

  // ---- fixtures, guides, providers
  if (fixtures) {
    for (const c of fixtures.competitions) {
      items.push({
        id: `fixtures-${c.id}`,
        name: c.name,
        group: c.sport === 'football' ? 'Fixtures › Football' : 'Fixtures › Other sports',
        type: 'catalog',
        contentType: 'fixtures',
        languages: [],
        path: 'catalogs/fixtures.json',
        attribution: c.providers.map((p) => ({ repo: p, channels: 0 })),
        channels: c.fixtures,
        lastRefresh: fixtures.generatedAt,
        importStatus: c.error && !c.fixtures ? 'error' : c.fixtures ? 'imported' : 'empty',
        validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 0 },
        note: 'Schedule data only; never a broadcast source.',
        error: c.error,
      });
    }
  }
  items.push({
    id: 'fixtures-football-data',
    name: 'football-data.org (live status & scores)',
    group: 'Fixtures › Football',
    type: 'api',
    contentType: 'fixtures',
    languages: [],
    url: 'https://api.football-data.org/v4/',
    attribution: [],
    channels: 0,
    lastRefresh: now,
    importStatus: process.env.FOOTBALL_DATA_TOKEN ? 'imported' : 'needs-credentials',
    validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 0 },
    note: 'Free key gives 12 competitions with delayed scores; needed for verified live status.',
  });
  for (const r of records.filter((x) => x.kind === 'epg-source')) {
    items.push({
      id: `epg-${r.uid}`,
      name: r.name.replace(/^https?:\/\//, ''),
      group: 'Programme guides',
      type: 'catalog',
      contentType: 'epg',
      languages: [],
      url: /^https?:/.test(r.name) ? r.name : undefined,
      path: /^https?:/.test(r.name) ? undefined : r.name,
      attribution: [{ repo: r.source.repo, channels: 0 }],
      channels: 0,
      lastRefresh: now,
      importStatus: 'imported',
      validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 1 },
      note: r.reasons[0],
    });
  }
  const caps = readJSON<Record<string, XtreamCapabilities>>(join(dir, 'generated/provider-capabilities.json'), {});
  for (const p of profiles) items.push(profileItem(dir, p, caps[p.id], now));
  // The M3U and Xtream dropdowns exist even before a profile is added, and say how to add one.
  const setup = (type: 'm3u' | 'xtream', name: string, note: string) => {
    if (profiles.some((p) => p.type === type)) return;
    items.push({ id: `profile-setup-${type}`, name, group: PROFILE_GROUP[type], type, contentType: 'mixed', languages: [], attribution: [], channels: 0, lastRefresh: now, importStatus: 'needs-setup', validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 0 }, note });
  };
  setup('m3u', 'Add an M3U / M3U8 playlist', 'On the PC: copy an "m3u" entry from provider-profiles/profiles.example.json into profiles.local.json, then npm run library:refresh.');
  setup('xtream', 'Add an Xtream-compatible provider', 'On the PC: add an "xtream" entry to provider-profiles/profiles.local.json, store its login with npm run library:secret -- set <id>, then npm run library:refresh.');
  for (const pr of problems) {
    items.push({ id: `profile-error-${pr.id}`, name: `Profile ${pr.id}`, group: PROFILE_GROUP.m3u, type: 'm3u', contentType: 'mixed', languages: [], attribution: [], channels: 0, lastRefresh: now, importStatus: 'error', validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 0 }, error: pr.problem });
  }

  // Playlists from earlier runs (renamed or removed lists) must not linger with outdated links.
  const pruned = prunePlaylists(dir, writtenPlaylists);
  if (pruned.length) log(`playlists: removed ${pruned.length} outdated file(s) not written by this run`);
  const groups = Array.from(new Set(items.map((i) => i.group)));
  const registry: Registry = { schema: 2, generatedAt: now, dataDir: dir, groups, items };
  write(join(dir, 'source-registry.json'), JSON.stringify(registry, null, 2));
  return { channels, registry, vod: { inventory: vodInventory.length + providerVod.length + providerSeries.length, byLanguage, unknown: unknownLang, other: otherLang } };
}

const PROFILE_GROUP = { m3u: 'My M3U playlists', xtream: 'My Xtream providers' } as const;

function profileItem(dir: string, p: Profile, caps: XtreamCapabilities | undefined, now: string): RegistryItem {
  const item: RegistryItem = {
    id: `profile-${p.id}`,
    name: p.name,
    group: PROFILE_GROUP[p.type],
    type: p.type,
    contentType: p.type === 'm3u' ? (p.contentType === 'live' ? 'live' : p.contentType === 'mixed' ? 'mixed' : p.contentType) : 'mixed',
    languages: p.type === 'm3u' ? p.languages || [] : [],
    profileRef: `provider-profiles/profiles.local.json#${p.id}`,
    attribution: [{ repo: `profile:${p.id}`, channels: 0 }],
    channels: 0,
    lastRefresh: now,
    importStatus: p.enabled ? 'imported' : 'needs-setup',
    validation: { checked: 0, reachable: 0, playbackConfirmed: 0, untested: 0 },
  };
  if (!p.enabled) item.note = 'Disabled in profiles.local.json.';
  if (p.type === 'xtream') {
    if (!hasCredentials(dir, p.id)) {
      item.importStatus = 'needs-credentials';
      item.error = `Store credentials with: npm run library:secret -- set ${p.id}`;
    } else if (caps) {
      item.importStatus = caps.authenticated ? (p.enabled ? 'imported' : 'needs-setup') : 'error';
      item.note = `Capabilities: live ${caps.live ? 'yes' : 'no'}, VOD ${caps.vod ? 'yes' : 'no'}, series ${caps.series ? 'yes' : 'no'}, XMLTV ${caps.xmltv ? 'yes' : 'no'}`;
      if (!caps.authenticated) item.error = caps.errors.slice(-1)[0];
    } else {
      item.note = 'Credentials stored; connection not tested yet (run library:refresh or library:xtream -- test).';
    }
  }
  return item;
}

export type { Fixture };

/** Deletes .m3u files under playlists/ that this run did not write; returns their paths. */
export function prunePlaylists(dir: string, written: Set<string>): string[] {
  const root = join(dir, 'playlists');
  const removed: string[] = [];
  const walk = (abs: string, rel: string) => {
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const a = join(abs, name);
      const r = `${rel}/${name}`;
      if (statSync(a).isDirectory()) walk(a, r);
      else if (/\.m3u8?$/i.test(name) && !written.has(r)) {
        unlinkSync(a);
        removed.push(r);
      }
    }
  };
  walk(root, 'playlists');
  return removed;
}
