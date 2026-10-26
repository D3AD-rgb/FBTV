import { beforeEach, describe, expect, it } from 'vitest';
import { clearAll, readJSON, writeJSON } from '../src/app/platform/storage.ts';

beforeEach(() => window.localStorage.clear());

describe('storage', () => {
  it('round-trips JSON under the app prefix', () => {
    expect(writeJSON('favourites', ['BBCNews.uk@SD'])).toBe(true);
    expect(readJSON('favourites', [])).toEqual(['BBCNews.uk@SD']);
    expect(window.localStorage.getItem('fbtv:favourites')).toContain('BBCNews');
  });

  it('returns the fallback for missing or corrupt data', () => {
    expect(readJSON('missing', 42)).toBe(42);
    window.localStorage.setItem('fbtv:bad', '{not json');
    expect(readJSON('bad', 'fallback')).toBe('fallback');
  });

  it('clearAll only removes FBTV keys', () => {
    writeJSON('a', 1);
    window.localStorage.setItem('other-app', 'keep');
    clearAll();
    expect(readJSON('a', null)).toBeNull();
    expect(window.localStorage.getItem('other-app')).toBe('keep');
  });
});
