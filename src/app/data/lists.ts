/**
 * Channel lists behind the Live TV chips and Home shelves, computed from the catalogue,
 * favourites and history. Memoised per catalogue/favourites/recents change.
 */
import type { CatalogueChannel } from '../../shared/model.ts';
import {
  advertisedUHDOnly,
  byName,
  checkedOnline,
  genreGroups,
  hasVerifiedUHD,
  kidsChannels,
  newsGroups,
  sportsGroups,
  ukGroups,
} from '../../shared/collections.ts';
import type { LoadedCatalogue } from './catalogue.ts';
import { numbering } from './catalogue.ts';
import { favourites, prefs, recents } from './library.ts';

export type ListId = 'all' | 'fav' | 'recent' | 'uk' | 'news' | 'sports' | 'kids' | 'movies' | 'series' | 'uhd' | 'online';

export const LIST_LABELS: Record<ListId, string> = {
  all: 'All channels',
  fav: '★ Favourites',
  recent: 'Recently watched',
  uk: 'UK TV',
  news: 'News',
  sports: 'Sports',
  kids: 'Kids',
  movies: 'Movie channels',
  series: 'Series channels',
  uhd: '4K',
  online: 'Checked online',
};

export const LIST_ORDER: ListId[] = ['all', 'fav', 'recent', 'uk', 'news', 'sports', 'kids', 'movies', 'series', 'uhd', 'online'];

function flatten(groups: { channels: CatalogueChannel[] }[]): CatalogueChannel[] {
  const seen = new Set<string>();
  const out: CatalogueChannel[] = [];
  for (const g of groups) for (const c of g.channels) if (!seen.has(c.id)) (seen.add(c.id), out.push(c));
  return out;
}

let memoKey = '';
let memoNumbers: ReturnType<typeof numbering> | null = null;
const memoLists = new Map<ListId, CatalogueChannel[]>();

function key(data: LoadedCatalogue): string {
  return `${data.generatedAt}|${favourites.value.join(',')}|${recents.value.length}:${recents.value[0] ? recents.value[0].id : ''}|${prefs.value.homeCountry}`;
}

function refresh(data: LoadedCatalogue): void {
  const k = key(data);
  if (k === memoKey) return;
  memoKey = k;
  memoNumbers = null;
  memoLists.clear();
}

export function channelNumbers(data: LoadedCatalogue): ReturnType<typeof numbering> {
  refresh(data);
  if (!memoNumbers) memoNumbers = numbering(data);
  return memoNumbers;
}

export function channelsFor(id: ListId, data: LoadedCatalogue): CatalogueChannel[] {
  refresh(data);
  const hit = memoLists.get(id);
  if (hit) return hit;
  const all = data.channels;
  const langs = prefs.value.languages;
  let list: CatalogueChannel[];
  switch (id) {
    case 'all': {
      const { byNumber } = channelNumbers(data);
      const nums: number[] = [];
      byNumber.forEach((_v, n) => nums.push(n));
      nums.sort((a, b) => a - b);
      list = nums.map((n) => data.byId.get(byNumber.get(n)!)!).filter(Boolean);
      break;
    }
    case 'fav':
      list = favourites.value.map((x) => data.byId.get(x)).filter(Boolean) as CatalogueChannel[];
      break;
    case 'recent':
      list = recents.value.map((r) => data.byId.get(r.id)).filter(Boolean) as CatalogueChannel[];
      break;
    case 'uk':
      list = flatten(ukGroups(all));
      break;
    case 'news':
      list = flatten(newsGroups(all, langs));
      break;
    case 'sports':
      list = flatten(sportsGroups(all));
      break;
    case 'kids':
      list = kidsChannels(all);
      break;
    case 'movies':
      list = flatten(genreGroups(all, 'movies', langs));
      break;
    case 'series':
      list = flatten(genreGroups(all, 'series', langs));
      break;
    case 'uhd':
      list = all.filter(hasVerifiedUHD).sort(byName).concat(all.filter(advertisedUHDOnly).sort(byName));
      break;
    case 'online':
      list = all.filter((c) => checkedOnline(c)).sort(byName);
      break;
  }
  memoLists.set(id, list);
  return list;
}
