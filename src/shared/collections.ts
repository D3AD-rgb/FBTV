/**
 * Collection rules for the browsing sections. Pure functions over catalogue channels, so
 * every rule is unit tested. Rules rely on structured metadata (country, language,
 * category, verified probes); name-based grouping is only used inside an already
 * reliable set (e.g. broadcaster families within UK channels) and is labelled as such.
 * Empty groups are dropped: a section only appears when the data supports it.
 */
import type { CatalogueChannel } from './model.ts';
import { isVerifiedUHD, qualityHeight } from './normalize.ts';

export interface Group {
  id: string;
  title: string;
  /** Optional note shown with the group, e.g. how it was classified. */
  note?: string;
  channels: CatalogueChannel[];
}

const has = (list: string[] | undefined, v: string) => !!list && list.indexOf(v) >= 0;
const hasAny = (list: string[] | undefined, vs: string[]) => !!list && vs.some((v) => list.indexOf(v) >= 0);

export function byName(a: CatalogueChannel, b: CatalogueChannel): number {
  const x = a.name.toLowerCase();
  const y = b.name.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
}

function groups(list: Group[]): Group[] {
  return list.filter((g) => g.channels.length > 0);
}

/** Streams the TV may try (header-only streams never reach the catalogue). */
export function playableStreams(ch: CatalogueChannel) {
  return ch.streams.filter((s) => !s.needsHeaders);
}

export function hasVerifiedUHD(ch: CatalogueChannel): boolean {
  return ch.streams.some((s) => isVerifiedUHD(s.probe));
}

export function advertisedUHDOnly(ch: CatalogueChannel): boolean {
  return !hasVerifiedUHD(ch) && ch.streams.some((s) => (qualityHeight(s.quality) || 0) >= 2160);
}

/** Highest verified height, else undefined (advertised values are reported separately). */
export function verifiedHeight(ch: CatalogueChannel): number | undefined {
  let h: number | undefined;
  for (const s of ch.streams) if (s.probe && (!h || s.probe.height > h)) h = s.probe.height;
  return h;
}

export function advertisedHeight(ch: CatalogueChannel): number | undefined {
  let h: number | undefined;
  for (const s of ch.streams) {
    const q = qualityHeight(s.quality);
    if (q && (!h || q > h)) h = q;
  }
  return h;
}

/** Online at the last check within `hours` (from the builder's probe). */
export function checkedOnline(ch: CatalogueChannel, now = Date.now(), hours = 24): boolean {
  return ch.streams.some((s) => s.status === 'online' && !!s.checkedAt && now - Date.parse(s.checkedAt) < hours * 3600000);
}

// ------------------------------------------------------------------ UK TV
const UK_FAMILIES: [string, string, RegExp][] = [
  ['bbc', 'BBC', /^bbc\b/i],
  ['itv', 'ITV', /^(itv|stv|utv)\b/i],
  ['channel4', 'Channel 4', /^(channel 4|e4|more4|film4|4seven)\b/i],
  ['channel5', 'Channel 5', /^(channel 5|5 ?usa|5 ?star|5 ?action|5 ?select)\b/i],
];

export function ukGroups(channels: CatalogueChannel[]): Group[] {
  const uk = channels.filter((c) => c.country === 'UK').sort(byName);
  const used = new Set<string>();
  const families: Group[] = UK_FAMILIES.map(([id, title, re]) => {
    const list = uk.filter((c) => re.test(c.name));
    list.forEach((c) => used.add(c.id));
    return { id: `uk:${id}`, title, note: 'Grouped by channel name', channels: list };
  });
  const rest = uk.filter((c) => !used.has(c.id));
  const cat = (id: string, title: string, cats: string[]) => {
    const list = rest.filter((c) => hasAny(c.categories, cats));
    list.forEach((c) => used.add(c.id));
    return { id: `uk:${id}`, title, channels: list };
  };
  const catGroups = [
    cat('general', 'General entertainment', ['general', 'entertainment']),
    cat('news', 'News', ['news']),
    cat('sports', 'Sports', ['sports']),
    cat('documentary', 'Documentaries', ['documentary', 'science', 'education']),
    cat('movies', 'Movies', ['movies']),
    cat('lifestyle', 'Lifestyle', ['lifestyle', 'cooking', 'travel', 'outdoor', 'shop', 'auto']),
    cat('kids', "Children's", ['kids', 'animation', 'family']),
    cat('music', 'Music', ['music']),
    cat('religious', 'Religious', ['religious']),
  ];
  const other = { id: 'uk:other', title: 'Other UK channels', channels: uk.filter((c) => !used.has(c.id)) };
  return groups(families.concat(catGroups, [other]));
}

// ------------------------------------------------------------------ News
export function newsGroups(channels: CatalogueChannel[], languages = ['eng']): Group[] {
  const news = channels.filter((c) => has(c.categories, 'news') && hasAny(c.languages, languages)).sort(byName);
  const business = channels.filter((c) => has(c.categories, 'business') && hasAny(c.languages, languages)).sort(byName);
  return groups([
    { id: 'news:uk', title: 'UK news', channels: news.filter((c) => c.country === 'UK') },
    { id: 'news:us', title: 'US news', channels: news.filter((c) => c.country === 'US') },
    { id: 'news:world', title: 'International & world news', channels: news.filter((c) => c.country !== 'UK' && c.country !== 'US') },
    { id: 'news:business', title: 'Business', channels: business },
  ]);
}

// ------------------------------------------------------------------ Sports
const SPORT_TITLES: [string, string][] = [
  ['football', 'Football'],
  ['cricket', 'Cricket'],
  ['rugby', 'Rugby'],
  ['tennis', 'Tennis'],
  ['basketball', 'Basketball'],
  ['motorsport', 'Motorsport'],
  ['golf', 'Golf'],
  ['combat', 'Combat sports'],
];

export function sportsGroups(channels: CatalogueChannel[]): Group[] {
  const sports = channels.filter((c) => has(c.categories, 'sports')).sort(byName);
  const ukIe = sports.filter((c) => c.country === 'UK' || c.country === 'IE');
  const english = sports.filter((c) => c.country !== 'UK' && c.country !== 'IE' && has(c.languages, 'eng'));
  const arabic = sports.filter((c) => has(c.languages, 'ara'));
  const other = sports.filter((c) => !has(c.languages, 'eng') && !has(c.languages, 'ara') && c.country !== 'UK' && c.country !== 'IE');
  const bySport = SPORT_TITLES.map(([id, title]) => ({
    id: `sports:${id}`,
    title,
    note: 'Classified from channel names or manual overrides',
    channels: sports.filter((c) => has(c.sports, id)),
  }));
  const tagged = new Set<string>();
  sports.forEach((c) => (c.sports || []).forEach(() => tagged.add(c.id)));
  return groups(
    [
      { id: 'sports:ukie', title: 'UK & Ireland', channels: ukIe },
      { id: 'sports:english', title: 'International (English)', channels: english },
      { id: 'sports:arabic', title: 'Arabic-language', note: 'From feed language metadata', channels: arabic },
      { id: 'sports:other', title: 'Other languages', channels: other },
    ].concat(bySport, [{ id: 'sports:general', title: 'Other sports', channels: sports.filter((c) => !tagged.has(c.id)) }]),
  );
}

// ------------------------------------------------------------------ Kids, 4K, Movies, Series
export function kidsChannels(channels: CatalogueChannel[]): CatalogueChannel[] {
  return channels.filter((c) => c.kids).sort(byName);
}

export function uhdGroups(channels: CatalogueChannel[]): Group[] {
  return groups([
    { id: 'uhd:verified', title: '4K · verified', note: 'Resolution measured by FBTV', channels: channels.filter(hasVerifiedUHD).sort(byName) },
    {
      id: 'uhd:advertised',
      title: 'Advertised as 4K · not verified',
      note: 'The source says 4K; FBTV has not measured it yet',
      channels: channels.filter(advertisedUHDOnly).sort(byName),
    },
  ]);
}

const GENRE_CATS: [string, string][] = [
  ['classic', 'Classics'],
  ['comedy', 'Comedy'],
  ['family', 'Family'],
  ['documentary', 'Documentary'],
  ['animation', 'Animation'],
  ['music', 'Music'],
];

/** Movie or series channels (24/7 live), grouped by co-occurring categories. */
export function genreGroups(channels: CatalogueChannel[], category: 'movies' | 'series', languages = ['eng']): Group[] {
  const all = channels.filter((c) => has(c.categories, category)).sort(byName);
  const preferred = all.filter((c) => hasAny(c.languages, languages));
  return groups(
    [{ id: `${category}:preferred`, title: 'In your languages', channels: preferred }]
      .concat(
        GENRE_CATS.map(([id, title]) => ({ id: `${category}:${id}`, title, channels: all.filter((c) => has(c.categories, id)) })),
      )
      .concat([{ id: `${category}:all`, title: 'All channels', channels: all }]),
  );
}

// ------------------------------------------------------------------ Countries
export interface CountryCount {
  code: string;
  count: number;
}

export function countryCounts(channels: CatalogueChannel[]): CountryCount[] {
  const map = new Map<string, number>();
  for (const c of channels) if (c.country) map.set(c.country, (map.get(c.country) || 0) + 1);
  const out: CountryCount[] = [];
  map.forEach((count, code) => out.push({ code, count }));
  return out.sort((a, b) => b.count - a.count);
}

/** A country's channels, grouped by category (categories in a fixed, sensible order). */
export function countryGroups(channels: CatalogueChannel[], code: string, categoryNames: Record<string, string>): Group[] {
  const list = channels.filter((c) => c.country === code).sort(byName);
  const order = ['general', 'news', 'sports', 'entertainment', 'movies', 'series', 'kids', 'animation', 'documentary', 'music', 'culture', 'lifestyle', 'religious'];
  const seen = new Set<string>();
  const out: Group[] = [];
  const cats: string[] = order.slice();
  for (const c of list) for (const g of c.categories || []) if (cats.indexOf(g) < 0) cats.push(g);
  for (const cat of cats) {
    const chans = list.filter((c) => (c.categories || [])[0] === cat || (!seen.has(c.id) && has(c.categories, cat)));
    const fresh = chans.filter((c) => !seen.has(c.id));
    fresh.forEach((c) => seen.add(c.id));
    if (fresh.length) out.push({ id: `country:${code}:${cat}`, title: categoryNames[cat] || cat, channels: fresh });
  }
  const rest = list.filter((c) => !seen.has(c.id));
  if (rest.length) out.push({ id: `country:${code}:other`, title: 'Other', channels: rest });
  return out;
}
