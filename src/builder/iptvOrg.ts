/**
 * Transforms the iptv-org API (https://iptv-org.github.io/api/) into normalised catalogue
 * channels. Pure: takes parsed JSON, returns channels plus a report of what was dropped.
 *
 * Rules:
 *  - skip closed channels, NSFW channels and anything on the iptv-org blocklist;
 *  - skip streams the TV cannot play (custom headers, non-HTTP protocols, DASH) and count why;
 *  - keep regional feeds as separate streams with their feed name (never merged by name);
 *  - quality stays "advertised" (FND-006); labels such as Geo-blocked are kept for the UI.
 */
import type { CatalogueChannel, CatalogueStream, CountryInfo, LanguageInfo } from '../shared/model.ts';
import { isKidsByCategory, sportsFromName, streamFingerprint } from '../shared/normalize.ts';
import { logoUsable } from '../shared/url.ts';

export interface IoChannel {
  id: string;
  name: string;
  alt_names?: string[];
  network?: string | null;
  country?: string;
  categories?: string[];
  is_nsfw?: boolean;
  closed?: string | null;
  replaced_by?: string | null;
}
export interface IoFeed {
  channel: string;
  id: string;
  name: string;
  is_main?: boolean;
  broadcast_area?: string[];
  languages?: string[];
  format?: string;
}
export interface IoStream {
  channel: string | null;
  feed: string | null;
  title?: string;
  url: string;
  quality?: string | null;
  labels?: string[] | null;
  user_agent?: string | null;
  referrer?: string | null;
}
export interface IoLogo {
  channel: string;
  feed: string | null;
  in_use?: boolean;
  width?: number;
  height?: number;
  format?: string | null;
  url: string;
}
export interface IoCountry {
  code: string;
  name: string;
  flag?: string;
  languages?: string[];
}
export interface IoLanguage {
  code: string;
  name: string;
}
export interface IoCategory {
  id: string;
  name: string;
}
export interface IoBlock {
  channel: string;
  reason?: string;
}

export interface IptvOrgData {
  channels: IoChannel[];
  feeds: IoFeed[];
  streams: IoStream[];
  logos: IoLogo[];
  countries: IoCountry[];
  languages: IoLanguage[];
  categories: IoCategory[];
  blocklist: IoBlock[];
}

export interface IptvOrgResult {
  channels: CatalogueChannel[];
  countries: CountryInfo[];
  languages: LanguageInfo[];
  categories: { id: string; name: string }[];
  dropped: Record<string, number>;
}

export const SOURCE_ID = 'iptv-org';

const PLAYABLE_URL = /^https?:\/\//i;

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] || 0) + 1;
}

function pickLogo(logos: IoLogo[] | undefined): string | undefined {
  if (!logos || !logos.length) return undefined;
  const usable = logos.filter((l) => l.in_use !== false && /^https:\/\//i.test(l.url) && logoUsable(l.url));
  const pool = usable.length ? usable : logos.filter((l) => /^https:\/\//i.test(l.url) && logoUsable(l.url));
  pool.sort((a, b) => {
    // imgur answers UK viewers with a "not available in your country" placeholder (FND-012),
    // so any other host is preferred when the channel has one.
    const ia = /(^|\.)imgur\.com\//.test(a.url.replace(/^https:\/\//, '')) ? 1 : 0;
    const ib = /(^|\.)imgur\.com\//.test(b.url.replace(/^https:\/\//, '')) ? 1 : 0;
    if (ia !== ib) return ia - ib;
    // Channel-level logos before feed-specific ones; then wider (but not huge) images.
    const fa = a.feed ? 1 : 0;
    const fb = b.feed ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const wa = Math.min(a.width || 0, 1000);
    const wb = Math.min(b.width || 0, 1000);
    return wb - wa;
  });
  return pool[0] ? pool[0].url : undefined;
}

/** Order: main feed, not geo-blocked, 24/7, higher advertised quality. */
export function streamRank(s: CatalogueStream, mainFeed: string | undefined): number {
  let r = 0;
  if (s.feed && s.feed === mainFeed) r += 1000;
  const labels = s.labels || [];
  if (labels.indexOf('Geo-blocked') < 0) r += 400;
  if (labels.indexOf('Not 24/7') < 0) r += 200;
  const q = s.quality ? parseInt(s.quality, 10) : 0;
  r += Math.min(q || 0, 2160) / 10;
  if (s.probe) r += 50;
  return r;
}

export function buildFromIptvOrg(data: IptvOrgData): IptvOrgResult {
  const dropped: Record<string, number> = {};
  const blocked = new Set(data.blocklist.map((b) => b.channel));
  const feedsByChannel = new Map<string, IoFeed[]>();
  for (const f of data.feeds) {
    const list = feedsByChannel.get(f.channel);
    if (list) list.push(f);
    else feedsByChannel.set(f.channel, [f]);
  }
  const logosByChannel = new Map<string, IoLogo[]>();
  for (const l of data.logos) {
    const list = logosByChannel.get(l.channel);
    if (list) list.push(l);
    else logosByChannel.set(l.channel, [l]);
  }
  const channelById = new Map<string, IoChannel>();
  for (const c of data.channels) channelById.set(c.id, c);

  const streamsByChannel = new Map<string, CatalogueStream[]>();
  const seen = new Set<string>();
  for (const s of data.streams) {
    if (!s.channel) {
      bump(dropped, 'stream-without-channel');
      continue;
    }
    const ch = channelById.get(s.channel);
    if (!ch) {
      bump(dropped, 'stream-unknown-channel');
      continue;
    }
    if (blocked.has(ch.id)) {
      bump(dropped, 'blocklisted');
      continue;
    }
    if (ch.closed || ch.is_nsfw) {
      bump(dropped, ch.closed ? 'channel-closed' : 'nsfw');
      continue;
    }
    if (!PLAYABLE_URL.test(s.url)) {
      bump(dropped, 'unsupported-protocol');
      continue;
    }
    if (/\.mpd(\?|$)/i.test(s.url)) {
      bump(dropped, 'dash');
      continue;
    }
    if (s.user_agent || s.referrer) {
      bump(dropped, 'needs-headers');
      continue;
    }
    const id = streamFingerprint(s.url);
    if (seen.has(id)) {
      bump(dropped, 'duplicate-url');
      continue;
    }
    seen.add(id);
    const feed = s.feed ? (feedsByChannel.get(ch.id) || []).filter((f) => f.id === s.feed)[0] : undefined;
    const stream: CatalogueStream = {
      id,
      url: s.url,
      source: SOURCE_ID,
    };
    if (s.feed) stream.feed = s.feed;
    if (feed && feed.name && !feed.is_main) stream.feedName = feed.name;
    if (s.quality) stream.quality = s.quality;
    if (s.labels && s.labels.length) stream.labels = s.labels.slice();
    if (feed && feed.languages && feed.languages.length) stream.languages = feed.languages.slice();
    const list = streamsByChannel.get(ch.id);
    if (list) list.push(stream);
    else streamsByChannel.set(ch.id, [stream]);
  }

  const channels: CatalogueChannel[] = [];
  streamsByChannel.forEach((streams, channelId) => {
    const ch = channelById.get(channelId)!;
    const feeds = feedsByChannel.get(channelId) || [];
    const main = feeds.filter((f) => f.is_main)[0];
    const mainId = main ? main.id : undefined;
    streams.sort((a, b) => streamRank(b, mainId) - streamRank(a, mainId));
    const languages: string[] = [];
    for (const s of streams) for (const l of s.languages || []) if (languages.indexOf(l) < 0) languages.push(l);
    const categories = (ch.categories || []).slice();
    const out: CatalogueChannel = {
      id: ch.id,
      name: ch.name,
      streams,
      sources: [SOURCE_ID],
      epgId: ch.id,
    };
    if (ch.alt_names && ch.alt_names.length) out.altNames = ch.alt_names.slice();
    if (ch.country) out.country = ch.country;
    if (languages.length) out.languages = languages;
    if (categories.length) out.categories = categories;
    if (ch.network) out.network = ch.network;
    const logo = pickLogo(logosByChannel.get(channelId));
    if (logo) out.logo = logo;
    if (categories.indexOf('sports') >= 0) {
      const sports = sportsFromName(ch.name, ch.alt_names || []);
      if (sports.length) {
        out.sports = sports;
        out.sportsBy = 'name';
      }
    }
    if (isKidsByCategory(categories)) {
      out.kids = true;
      out.kidsBy = 'category';
    }
    channels.push(out);
  });
  channels.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const usedCountries = new Set(channels.map((c) => c.country).filter(Boolean) as string[]);
  const usedLanguages = new Set<string>();
  const usedCategories = new Set<string>();
  for (const c of channels) {
    for (const l of c.languages || []) usedLanguages.add(l);
    for (const g of c.categories || []) usedCategories.add(g);
  }
  return {
    channels,
    countries: data.countries
      .filter((c) => usedCountries.has(c.code))
      .map((c) => ({ code: c.code, name: c.name, flag: c.flag, languages: c.languages })),
    languages: data.languages.filter((l) => usedLanguages.has(l.code)).map((l) => ({ code: l.code, name: l.name })),
    categories: data.categories.filter((c) => usedCategories.has(c.id)).map((c) => ({ id: c.id, name: c.name })),
    dropped,
  };
}
