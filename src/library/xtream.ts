/**
 * Xtream Codes–compatible provider adapter (for accounts you are authorised to use).
 *
 * Providers differ, so nothing is assumed: authentication tries several account actions
 * (as iptvnator does), and live / VOD / series / XMLTV support are each probed separately.
 * Imported items store the profile id and stream id — never a URL, because Xtream play
 * URLs embed the username and password. URLs are built only at play time.
 */
import type { Credentials } from './secrets.ts';
import { maskSecrets } from './secrets.ts';
import type { XtreamProfile } from './profiles.ts';

export type Fetcher = (url: string, timeoutMs: number) => Promise<{ status: number; text: string }>;

export const defaultFetcher: Fetcher = async (url, timeoutMs) => {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'FBTV-library/0.3' } });
    return { status: r.status, text: await r.text() };
  } finally {
    clearTimeout(t);
  }
};

export interface XtreamCapabilities {
  authenticated: boolean;
  accountStatus?: string;
  expiresAt?: string | null;
  maxConnections?: number;
  outputFormats?: string[];
  live: boolean;
  vod: boolean;
  series: boolean;
  xmltv: boolean;
  errors: string[];
}

export interface VodItem {
  profile: string;
  streamId: string;
  title: string;
  categoryId?: string;
  category?: string;
  poster?: string;
  year?: string;
  rating?: string;
  added?: string;
  extension?: string;
  languages: string[];
  languageSource: 'provider-field' | 'user-category-map' | 'none';
}

export interface SeriesItem {
  profile: string;
  seriesId: string;
  title: string;
  categoryId?: string;
  category?: string;
  poster?: string;
  plot?: string;
  year?: string;
  languages: string[];
  languageSource: 'provider-field' | 'user-category-map' | 'none';
  seasons?: { season: number; episodes: { episodeId: string; episode: number; title: string; extension?: string }[] }[];
}

function base(server: string): string {
  return server.replace(/\/+$/, '').replace(/\/player_api\.php$/i, '');
}

export function apiUrl(server: string, c: Credentials, action: string, extra: Record<string, string> = {}): string {
  const q = [`username=${encodeURIComponent(c.username)}`, `password=${encodeURIComponent(c.password)}`];
  if (action) q.push(`action=${encodeURIComponent(action)}`);
  for (const k of Object.keys(extra)) q.push(`${k}=${encodeURIComponent(extra[k]!)}`);
  return `${base(server)}/player_api.php?${q.join('&')}`;
}

async function call<T>(f: Fetcher, profile: XtreamProfile, c: Credentials, action: string, extra?: Record<string, string>): Promise<T> {
  let r: { status: number; text: string };
  try {
    r = await f(apiUrl(profile.server, c, action, extra), 25000);
  } catch (err) {
    throw new Error(maskSecrets(`${action || 'auth'}: ${(err as Error).message}`, c));
  }
  if (r.status < 200 || r.status >= 300) throw new Error(`${action || 'auth'}: HTTP ${r.status}`);
  try {
    return JSON.parse(r.text) as T;
  } catch {
    throw new Error(`${action || 'auth'}: response was not JSON`);
  }
}

interface AccountPayload {
  user_info?: { auth?: number | string; status?: string; exp_date?: string | null; max_connections?: string | number; allowed_output_formats?: string[] };
}

export async function detectCapabilities(profile: XtreamProfile, c: Credentials, f: Fetcher = defaultFetcher): Promise<XtreamCapabilities> {
  const caps: XtreamCapabilities = { authenticated: false, live: false, vod: false, series: false, xmltv: false, errors: [] };
  for (const action of ['get_account_info', '', 'get_profile']) {
    try {
      const p = await call<AccountPayload>(f, profile, c, action);
      if (p && p.user_info && String(p.user_info.auth) === '1') {
        caps.authenticated = true;
        caps.accountStatus = p.user_info.status;
        caps.expiresAt = p.user_info.exp_date
          ? /^\d+$/.test(String(p.user_info.exp_date))
            ? new Date(Number(p.user_info.exp_date) * 1000).toISOString()
            : String(p.user_info.exp_date)
          : null;
        caps.maxConnections = p.user_info.max_connections !== undefined ? Number(p.user_info.max_connections) : undefined;
        caps.outputFormats = p.user_info.allowed_output_formats;
        break;
      }
    } catch (err) {
      caps.errors.push((err as Error).message);
    }
  }
  if (!caps.authenticated) {
    caps.errors.push('Authentication failed: check the server address and credentials.');
    return caps;
  }
  for (const [kind, action] of [
    ['live', 'get_live_categories'],
    ['vod', 'get_vod_categories'],
    ['series', 'get_series_categories'],
  ] as const) {
    try {
      const cats = await call<unknown>(f, profile, c, action);
      caps[kind] = Array.isArray(cats);
      if (!Array.isArray(cats)) caps.errors.push(`${action}: not supported by this provider`);
    } catch (err) {
      caps.errors.push((err as Error).message);
    }
  }
  try {
    const r = await f(`${base(profile.server)}/xmltv.php?username=${encodeURIComponent(c.username)}&password=${encodeURIComponent(c.password)}`, 25000);
    caps.xmltv = r.status === 200 && /<tv[\s>]/.test(r.text.slice(0, 2000));
  } catch {
    caps.xmltv = false;
  }
  return caps;
}

/** Language from an explicit provider field, else the user's category map, else none. Pure. */
export function languageFor(
  item: Record<string, unknown>,
  categoryName: string | undefined,
  map: Record<string, string> | undefined,
): { languages: string[]; languageSource: VodItem['languageSource'] } {
  for (const k of ['language', 'lang', 'audio_language']) {
    const v = item[k];
    if (typeof v === 'string' && v.trim()) {
      const code = normalizeLang(v);
      if (code) return { languages: [code], languageSource: 'provider-field' };
    }
  }
  if (categoryName && map) {
    const name = categoryName.toLowerCase();
    for (const key of Object.keys(map)) {
      if (name.indexOf(key.toLowerCase()) >= 0) return { languages: [map[key]!], languageSource: 'user-category-map' };
    }
  }
  return { languages: [], languageSource: 'none' };
}

function normalizeLang(v: string): string | undefined {
  const s = v.trim().toLowerCase();
  const map: Record<string, string> = { en: 'eng', eng: 'eng', english: 'eng', hi: 'hin', hin: 'hin', hindi: 'hin', bn: 'ben', ben: 'ben', bengali: 'ben', bangla: 'ben' };
  return map[s] || (/^[a-z]{3}$/.test(s) ? s : undefined);
}

interface Category {
  category_id: string | number;
  category_name: string;
}

export async function importVod(profile: XtreamProfile, c: Credentials, f: Fetcher = defaultFetcher): Promise<VodItem[]> {
  const cats = await call<Category[]>(f, profile, c, 'get_vod_categories');
  const names = new Map<string, string>();
  for (const k of cats || []) names.set(String(k.category_id), k.category_name);
  const streams = await call<Record<string, unknown>[]>(f, profile, c, 'get_vod_streams');
  return (streams || []).map((s) => {
    const catId = s.category_id !== undefined ? String(s.category_id) : undefined;
    const cat = catId ? names.get(catId) : undefined;
    const lang = languageFor(s, cat, profile.categoryLanguages);
    const item: VodItem = {
      profile: profile.id,
      streamId: String(s.stream_id),
      title: String(s.name || '').trim(),
      languages: lang.languages,
      languageSource: lang.languageSource,
    };
    if (catId) item.categoryId = catId;
    if (cat) item.category = cat;
    if (typeof s.stream_icon === 'string' && /^https?:\/\//.test(s.stream_icon)) item.poster = s.stream_icon;
    if (s.rating) item.rating = String(s.rating);
    if (s.added) item.added = String(s.added);
    if (s.container_extension) item.extension = String(s.container_extension);
    if (s.year) item.year = String(s.year);
    return item;
  });
}

export async function importSeries(profile: XtreamProfile, c: Credentials, f: Fetcher = defaultFetcher): Promise<SeriesItem[]> {
  const cats = await call<Category[]>(f, profile, c, 'get_series_categories');
  const names = new Map<string, string>();
  for (const k of cats || []) names.set(String(k.category_id), k.category_name);
  const list = await call<Record<string, unknown>[]>(f, profile, c, 'get_series');
  return (list || []).map((s) => {
    const catId = s.category_id !== undefined ? String(s.category_id) : undefined;
    const cat = catId ? names.get(catId) : undefined;
    const lang = languageFor(s, cat, profile.categoryLanguages);
    const item: SeriesItem = {
      profile: profile.id,
      seriesId: String(s.series_id),
      title: String(s.name || '').trim(),
      languages: lang.languages,
      languageSource: lang.languageSource,
    };
    if (catId) item.categoryId = catId;
    if (cat) item.category = cat;
    if (typeof s.cover === 'string' && /^https?:\/\//.test(s.cover)) item.poster = s.cover;
    if (s.plot) item.plot = String(s.plot);
    if (s.releaseDate || s.year) item.year = String(s.releaseDate || s.year).slice(0, 4);
    return item;
  });
}

/** Fetches seasons and episodes for one series (one request; caller rate-limits). */
export async function importEpisodes(profile: XtreamProfile, c: Credentials, s: SeriesItem, f: Fetcher = defaultFetcher): Promise<SeriesItem> {
  const info = await call<{ episodes?: Record<string, { id: string | number; episode_num?: number | string; title?: string; container_extension?: string }[]> }>(
    f,
    profile,
    c,
    'get_series_info',
    { series_id: s.seriesId },
  );
  const seasons: NonNullable<SeriesItem['seasons']> = [];
  const eps = (info && info.episodes) || {};
  for (const key of Object.keys(eps).sort((a, b) => Number(a) - Number(b))) {
    seasons.push({
      season: Number(key),
      episodes: (eps[key] || [])
        .map((e) => ({ episodeId: String(e.id), episode: Number(e.episode_num || 0), title: String(e.title || ''), extension: e.container_extension }))
        .sort((a, b) => a.episode - b.episode),
    });
  }
  return { ...s, seasons };
}

/** Builds a play URL at play time only. Never store or log the result. */
export function playUrl(profile: XtreamProfile, c: Credentials, kind: 'live' | 'movie' | 'series', id: string, ext: string): string {
  return `${base(profile.server)}/${kind}/${encodeURIComponent(c.username)}/${encodeURIComponent(c.password)}/${id}.${ext}`;
}
