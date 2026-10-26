/**
 * Builds the local search index from the loaded catalogue (only imported data — nothing
 * here can invent a result). Rebuilt when the catalogue changes; built lazily on first use.
 */
import { SearchIndex, type SearchDoc } from '../../shared/search.ts';
import { hasVerifiedUHD } from '../../shared/collections.ts';
import type { LoadedCatalogue } from './catalogue.ts';

let cache: { key: string; index: SearchIndex } | null = null;

export const COLLECTION_DOCS: SearchDoc[] = [
  { kind: 'collection', id: 'uk', title: 'UK TV', keywords: ['united kingdom', 'british', 'uk channels'] },
  { kind: 'collection', id: 'news', title: 'News', keywords: ['english news', 'world news'] },
  { kind: 'collection', id: 'sports', title: 'Sports', keywords: ['sport channels'] },
  { kind: 'collection', id: 'sports:arabic', title: 'Arabic sports', keywords: ['arabic', 'sports'] },
  { kind: 'collection', id: 'sports:football', title: 'Football channels', keywords: ['football', 'sports'] },
  { kind: 'collection', id: 'kids', title: 'Kids', keywords: ['children', 'animation'] },
  { kind: 'collection', id: 'uhd', title: '4K channels', keywords: ['4k', 'uhd'] },
  { kind: 'collection', id: 'movies', title: 'Movie channels', keywords: ['movies'] },
  { kind: 'collection', id: 'series', title: 'Series channels', keywords: ['series'] },
];

export function buildDocs(data: LoadedCatalogue): SearchDoc[] {
  const docs: SearchDoc[] = [];
  for (const c of data.channels) {
    const kw: string[] = [];
    if (c.altNames) kw.push(...c.altNames);
    if (c.country) {
      kw.push(c.country);
      const co = data.countryById.get(c.country);
      if (co) kw.push(co.name);
    }
    for (const l of c.languages || []) kw.push(data.languageName[l] || l);
    for (const g of c.categories || []) kw.push(data.categoryName[g] || g);
    if (c.sports) kw.push(...c.sports);
    if (c.kids) kw.push('kids');
    if (hasVerifiedUHD(c)) kw.push('4k', 'uhd');
    if (c.network) kw.push(c.network);
    docs.push({ kind: 'channel', id: c.id, title: c.name, keywords: kw });
  }
  for (const co of data.countries) {
    docs.push({ kind: 'country', id: co.code, title: co.name, keywords: [co.code, co.code === 'UK' ? 'gb' : ''] });
  }
  for (const l of data.languages) docs.push({ kind: 'language', id: l.code, title: l.name, keywords: [l.code] });
  for (const id of Object.keys(data.categoryName)) {
    docs.push({ kind: 'category', id, title: data.categoryName[id]!, keywords: [id] });
  }
  return docs.concat(COLLECTION_DOCS);
}

export function searchIndexFor(data: LoadedCatalogue): SearchIndex {
  if (cache && cache.key === data.generatedAt) return cache.index;
  const index = new SearchIndex(buildDocs(data));
  cache = { key: data.generatedAt, index };
  return index;
}
