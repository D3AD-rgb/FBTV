// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CatalogueChannel } from '../src/shared/model.ts';
import {
  countryCounts,
  countryGroups,
  genreGroups,
  kidsChannels,
  newsGroups,
  sportsGroups,
  ukGroups,
  uhdGroups,
  checkedOnline,
  verifiedHeight,
  advertisedHeight,
} from '../src/shared/collections.ts';

// TEST DATA — synthetic channels; names and streams are invented.
let n = 0;
function ch(p: Partial<CatalogueChannel> & { name: string }): CatalogueChannel {
  n++;
  return {
    id: p.id || `T${n}.xx`,
    streams: p.streams || [{ id: `s${n}`, url: `https://x.test/${n}.m3u8`, source: 'iptv-org' }],
    sources: ['iptv-org'],
    ...p,
  } as CatalogueChannel;
}

const CH = [
  ch({ name: 'BBC Test One', country: 'UK', languages: ['eng'], categories: ['general'] }),
  ch({ name: 'ITV Example', country: 'UK', languages: ['eng'], categories: ['entertainment'] }),
  ch({ name: 'E4 Sample', country: 'UK', languages: ['eng'], categories: ['entertainment'] }),
  ch({ name: 'UK Test News', country: 'UK', languages: ['eng'], categories: ['news'] }),
  ch({ name: 'Doc Channel', country: 'UK', languages: ['eng'], categories: ['documentary'] }),
  ch({ name: 'US Test News', country: 'US', languages: ['eng'], categories: ['news'] }),
  ch({ name: 'World Test News', country: 'QA', languages: ['eng'], categories: ['news'] }),
  ch({ name: 'French News', country: 'FR', languages: ['fra'], categories: ['news'] }),
  ch({ name: 'Money Test', country: 'US', languages: ['eng'], categories: ['business'] }),
  ch({ name: 'Arab Test Football', country: 'SA', languages: ['ara'], categories: ['sports'], sports: ['football'] }),
  ch({ name: 'Irish Sport', country: 'IE', languages: ['eng'], categories: ['sports'] }),
  ch({ name: 'Global Cricket', country: 'IN', languages: ['eng'], categories: ['sports'], sports: ['cricket'] }),
  ch({ name: 'Toon Test', country: 'US', languages: ['eng'], categories: ['kids'], kids: true }),
  ch({ name: 'Classic Films', country: 'US', languages: ['eng'], categories: ['movies', 'classic'] }),
  ch({
    name: 'Big Picture',
    country: 'DE',
    languages: ['deu'],
    categories: ['general'],
    streams: [{ id: 'uhd', url: 'https://x.test/uhd.m3u8', source: 'iptv-org', quality: '2160p', probe: { width: 3840, height: 2160, at: '2026-10-26T00:00:00Z' } }],
  }),
  ch({
    name: 'Claims 4K',
    country: 'DE',
    languages: ['deu'],
    categories: ['general'],
    streams: [{ id: 'adv', url: 'https://x.test/adv.m3u8', source: 'iptv-org', quality: '2160p' }],
  }),
];

const titles = (gs: { title: string }[]) => gs.map((g) => g.title);
const names = (gs: { title: string; channels: CatalogueChannel[] }[], title: string) =>
  (gs.filter((g) => g.title === title)[0] || { channels: [] }).channels.map((c) => c.name);

describe('UK TV', () => {
  const g = ukGroups(CH);
  it('groups broadcaster families, then categories, and drops empty groups', () => {
    expect(titles(g)).toEqual(['BBC', 'ITV', 'Channel 4', 'News', 'Documentaries']);
    expect(names(g, 'Channel 4')).toEqual(['E4 Sample']);
  });
  it('only contains UK channels', () => {
    expect(g.every((x) => x.channels.every((c) => c.country === 'UK'))).toBe(true);
  });
});

describe('News', () => {
  it('uses language metadata, splits UK / US / world, and lists business', () => {
    const g = newsGroups(CH, ['eng']);
    expect(titles(g)).toEqual(['UK news', 'US news', 'International & world news', 'Business']);
    expect(names(g, 'International & world news')).toEqual(['World Test News']);
    expect(g.some((x) => x.channels.some((c) => c.name === 'French News'))).toBe(false);
  });
});

describe('Sports', () => {
  const g = sportsGroups(CH);
  it('groups by region and language, never inferring commentary language from country', () => {
    expect(names(g, 'UK & Ireland')).toEqual(['Irish Sport']);
    expect(names(g, 'Arabic-language')).toEqual(['Arab Test Football']);
    expect(names(g, 'International (English)')).toEqual(['Global Cricket']);
  });
  it('adds sport shelves only for tagged channels', () => {
    expect(names(g, 'Football')).toEqual(['Arab Test Football']);
    expect(names(g, 'Cricket')).toEqual(['Global Cricket']);
    expect(titles(g)).not.toContain('Tennis');
  });
});

describe('Kids, 4K, Movies', () => {
  it('kids only from the kids flag', () => {
    expect(kidsChannels(CH).map((c) => c.name)).toEqual(['Toon Test']);
  });
  it('separates verified 4K from advertised 4K', () => {
    const g = uhdGroups(CH);
    expect(names(g, '4K · verified')).toEqual(['Big Picture']);
    expect(names(g, 'Advertised as 4K · not verified')).toEqual(['Claims 4K']);
    expect(verifiedHeight(CH[14]!)).toBe(2160);
    expect(verifiedHeight(CH[15]!)).toBeUndefined();
    expect(advertisedHeight(CH[15]!)).toBe(2160);
  });
  it('genre shelves come from co-occurring categories', () => {
    const g = genreGroups(CH, 'movies', ['eng']);
    expect(titles(g)).toEqual(['In your languages', 'Classics', 'All channels']);
  });
});

describe('Countries', () => {
  it('counts every country present, largest first', () => {
    const c = countryCounts(CH);
    expect(c[0]).toEqual({ code: 'UK', count: 5 });
    expect(c.map((x) => x.code)).toContain('IE');
  });
  it('groups a country by category without duplicates', () => {
    const g = countryGroups(CH, 'UK', { general: 'General', news: 'News', entertainment: 'Entertainment', documentary: 'Documentary' });
    const all = g.flatMap((x) => x.channels.map((c) => c.name));
    expect(all.length).toBe(new Set(all).size);
    expect(titles(g)).toEqual(['General', 'News', 'Entertainment', 'Documentary']);
  });
});

describe('checkedOnline', () => {
  it('needs an online result within the window', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const fresh = ch({ name: 'A', streams: [{ id: 'a', url: 'https://x.test/a', source: 's', status: 'online', checkedAt: '2026-10-26T06:00:00Z' }] });
    const stale = ch({ name: 'B', streams: [{ id: 'b', url: 'https://x.test/b', source: 's', status: 'online', checkedAt: '2026-10-24T06:00:00Z' }] });
    const off = ch({ name: 'C', streams: [{ id: 'c', url: 'https://x.test/c', source: 's', status: 'offline', checkedAt: '2026-10-26T06:00:00Z' }] });
    expect([fresh, stale, off].map((c) => checkedOnline(c, now))).toEqual([true, false, false]);
  });
});
