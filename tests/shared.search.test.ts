// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { SearchIndex, boundedDistance, expandQuery, type SearchDoc } from '../src/shared/search.ts';

// TEST DATA — synthetic documents shaped like the catalogue's, not real availability.
const DOCS: SearchDoc[] = [
  { kind: 'channel', id: 'BBCOne.uk', title: 'BBC One', keywords: ['united kingdom', 'english', 'general'] },
  { kind: 'channel', id: 'BBCOneScotland.uk', title: 'BBC One Scotland', keywords: ['united kingdom', 'english', 'general'] },
  { kind: 'channel', id: 'NewsBD.bd', title: 'Somoy Test News', keywords: ['bangladesh', 'bengali', 'news'] },
  { kind: 'channel', id: 'ArabSport.sa', title: 'Example Sports 1', keywords: ['saudi arabia', 'arabic', 'sports'] },
  { kind: 'channel', id: 'EngNews.us', title: 'Example World News', keywords: ['united states', 'english', 'news'] },
  { kind: 'channel', id: 'Cric.in', title: 'Test Cricket HD', keywords: ['india', 'english', 'sports', 'cricket'] },
  { kind: 'country', id: 'UK', title: 'United Kingdom', keywords: ['uk', 'gb'] },
  { kind: 'country', id: 'BD', title: 'Bangladesh', keywords: ['bd'] },
  { kind: 'collection', id: '4k', title: '4K channels', keywords: ['uhd', '2160p', '4k'] },
  { kind: 'competition', id: 'PL', title: 'Premier League', keywords: ['england', 'epl'] },
  { kind: 'competition', id: 'CL', title: 'UEFA Champions League', keywords: ['europe', 'ucl'] },
  { kind: 'team', id: '86', title: 'Real Madrid CF', keywords: ['spain'] },
  { kind: 'team', id: '57', title: 'Arsenal FC', keywords: ['england'] },
];

const index = new SearchIndex(DOCS);
const ids = (q: string) => index.search(q).map((h) => h.doc.id);

describe('expandQuery', () => {
  it('expands abbreviations and drops stopwords', () => {
    expect(expandQuery('EPL')).toEqual(['premier', 'league']);
    expect(expandQuery('UK channels')).toEqual(['united', 'kingdom']);
    expect(expandQuery('channels')).toEqual(['channels']);
  });
});

describe('SearchIndex', () => {
  it('ranks an exact title match first', () => {
    expect(ids('BBC One')[0]).toBe('BBCOne.uk');
    expect(ids('bbc one')).toContain('BBCOneScotland.uk');
  });

  it('matches partial words and punctuation-insensitive input', () => {
    expect(ids('bbc')).toEqual(expect.arrayContaining(['BBCOne.uk', 'BBCOneScotland.uk']));
    expect(ids('B.B.C. one')).toContain('BBCOne.uk');
  });

  it('combines facets with AND (English news, Arabic sports, Bangladeshi news)', () => {
    expect(ids('English news')).toEqual(['EngNews.us']);
    expect(ids('Arabic sports')).toEqual(['ArabSport.sa']);
    expect(ids('Bangladeshi news')).toEqual(['NewsBD.bd']);
  });

  it('finds countries by name and code, competitions by abbreviation', () => {
    expect(ids('UK channels')).toContain('UK');
    expect(ids('Bangladesh')).toEqual(expect.arrayContaining(['BD', 'NewsBD.bd']));
    expect(ids('EPL')).toEqual(['PL']);
    expect(ids('Premier League')).toEqual(['PL']);
    expect(ids('Champions League')).toEqual(['CL']);
    expect(ids('4K')).toEqual(['4k']);
  });

  it('tolerates small spelling mistakes on longer words', () => {
    expect(ids('Arsenl')).toContain('57');
    expect(ids('cricket')).toContain('Cric.in');
    expect(ids('crikcet')).toContain('Cric.in');
    expect(ids('zzzz')).toEqual([]);
  });

  it('groups results by kind', () => {
    const g = index.grouped('real madrid');
    expect(g.map((x) => x.kind)).toEqual(['team']);
  });

  it('can restrict to an allowlist (Kids Mode)', () => {
    const kidsOnly = index.search('news', { filter: (d) => d.id === 'NewsBD.bd' });
    expect(kidsOnly.map((h) => h.doc.id)).toEqual(['NewsBD.bd']);
  });
});

describe('boundedDistance', () => {
  it('computes small distances and bails out early', () => {
    expect(boundedDistance('kitten', 'sitten', 2)).toBe(1);
    expect(boundedDistance('abc', 'xyzabc', 1)).toBe(2);
  });
});
