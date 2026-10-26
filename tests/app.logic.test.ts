import { beforeEach, describe, expect, it } from 'vitest';
import { stepInList } from '../src/app/screens/Watch.tsx';
import { windowStart } from '../src/app/ui/VirtualList.tsx';
import { matchCountry } from '../src/app/screens/Countries.tsx';
import { isPlaceholderImage, monogram } from '../src/app/ui/ChannelTile.tsx';
import { favourites, recents, toggleFavourite, recordWatched, moveFavourite, reloadLibrary } from '../src/app/data/library.ts';
import { numbering, type LoadedCatalogue } from '../src/app/data/catalogue.ts';
import type { CatalogueChannel } from '../src/shared/model.ts';

describe('stepInList (channel up/down)', () => {
  const ids = ['a', 'b', 'c'];
  it('steps and wraps around both ends', () => {
    expect(stepInList(ids, 'a', 1)).toBe('b');
    expect(stepInList(ids, 'c', 1)).toBe('a');
    expect(stepInList(ids, 'a', -1)).toBe('c');
    expect(stepInList(ids, 'zz', 1)).toBe('b');
    expect(stepInList([], 'a', 1)).toBeNull();
  });
});

describe('windowStart (virtual list)', () => {
  it('scrolls only when the index leaves the window and clamps at the end', () => {
    expect(windowStart(3, 0, 8, 100)).toBe(0);
    expect(windowStart(8, 0, 8, 100)).toBe(1);
    expect(windowStart(2, 5, 8, 100)).toBe(2);
    expect(windowStart(99, 0, 8, 100)).toBe(92);
    expect(windowStart(3, 0, 8, 4)).toBe(0);
  });
});

describe('matchCountry', () => {
  it('matches names, prefixes, codes, and GB for the UK', () => {
    expect(matchCountry('bang', 'BD', 'Bangladesh')).toBe(true);
    expect(matchCountry('BD', 'BD', 'Bangladesh')).toBe(true);
    expect(matchCountry('gb', 'UK', 'United Kingdom')).toBe(true);
    expect(matchCountry('kingdom', 'UK', 'United Kingdom')).toBe(true);
    expect(matchCountry('desh', 'BD', 'Bangladesh')).toBe(false);
    expect(matchCountry('', 'BD', 'Bangladesh')).toBe(true);
  });
});

describe('logos', () => {
  it('treats imgur\'s geo-block placeholder and empty images as missing (FND-012)', () => {
    expect(isPlaceholderImage({ naturalWidth: 336, naturalHeight: 478, src: 'https://i.imgur.com/abc.png' })).toBe(true);
    expect(isPlaceholderImage({ naturalWidth: 0, naturalHeight: 0, src: 'https://x.test/a.png' })).toBe(true);
    expect(isPlaceholderImage({ naturalWidth: 336, naturalHeight: 478, src: 'https://x.test/a.png' })).toBe(false);
    expect(isPlaceholderImage({ naturalWidth: 512, naturalHeight: 256, src: 'https://i.imgur.com/abc.png' })).toBe(false);
  });
  it('builds monograms from names', () => {
    expect(monogram('BBC News (UK)')).toBe('BBC NEWS UK');
  });
});

describe('favourites and history (persisted)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reloadLibrary();
  });
  it('toggles, orders and persists favourites', () => {
    expect(toggleFavourite('a')).toBe(true);
    toggleFavourite('b');
    moveFavourite('b', -1);
    expect(favourites.value).toEqual(['b', 'a']);
    reloadLibrary();
    expect(favourites.value).toEqual(['b', 'a']);
    expect(toggleFavourite('a')).toBe(false);
    expect(favourites.value).toEqual(['b']);
  });
  it('keeps recents unique, newest first, bounded', () => {
    for (let i = 0; i < 50; i++) recordWatched(`c${i}`, i);
    recordWatched('c10', 100);
    expect(recents.value[0]!.id).toBe('c10');
    expect(recents.value.length).toBe(40);
    expect(recents.value.filter((r) => r.id === 'c10')).toHaveLength(1);
  });
});

describe('channel numbering', () => {
  beforeEach(() => {
    window.localStorage.clear();
    reloadLibrary();
  });
  it('numbers favourites 1…N, then home-country channels from 101', () => {
    const mk = (id: string, country: string): CatalogueChannel => ({ id, name: id, country, streams: [], sources: [] });
    const channels = [mk('fr1', 'FR'), mk('uk1', 'UK'), mk('uk2', 'UK'), mk('us1', 'US')];
    const data = { channels, byId: new Map(channels.map((c) => [c.id, c])) } as unknown as LoadedCatalogue;
    toggleFavourite('us1');
    const { numberOf, byNumber } = numbering(data);
    expect(numberOf.get('us1')).toBe(1);
    expect(numberOf.get('uk1')).toBe(101);
    expect(numberOf.get('uk2')).toBe(102);
    expect(numberOf.get('fr1')).toBe(103);
    expect(byNumber.get(101)).toBe('uk1');
  });
});
