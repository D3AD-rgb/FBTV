// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  canonicalName,
  fold,
  isKidsByCategory,
  isVerifiedUHD,
  normalizeCountry,
  normalizeLanguages,
  qualityHeight,
  sportsFromName,
  streamFingerprint,
} from '../src/shared/normalize.ts';

describe('normalisation', () => {
  it('folds case, accents and punctuation', () => {
    expect(fold('  Télé-Québec & Co. ')).toBe('tele quebec and co');
    expect(fold('BBC ONE')).toBe('bbc one');
  });

  it('canonical names drop feed decorations but keep identity words', () => {
    expect(canonicalName('BBC One HD')).toBe('bbc one');
    expect(canonicalName('Sky Sports News FHD')).toBe('sky sports news');
    expect(canonicalName('BBC One Scotland')).toBe('bbc one scotland');
  });

  it('maps GB to iptv-org UK and rejects junk', () => {
    expect(normalizeCountry('gb')).toBe('UK');
    expect(normalizeCountry('UK')).toBe('UK');
    expect(normalizeCountry('BD')).toBe('BD');
    expect(normalizeCountry('United Kingdom')).toBeUndefined();
    expect(normalizeCountry('')).toBeUndefined();
  });

  it('normalises language codes and names to ISO 639-3', () => {
    expect(normalizeLanguages(['en', 'eng', 'English;ar', 'Bangla', 'xx'])).toEqual(['eng', 'ara', 'ben']);
  });

  it('reads advertised quality but only probes verify 4K', () => {
    expect(qualityHeight('1080p')).toBe(1080);
    expect(qualityHeight('4K')).toBe(2160);
    expect(qualityHeight(undefined)).toBeUndefined();
    expect(isVerifiedUHD({ width: 3840, height: 2160 })).toBe(true);
    expect(isVerifiedUHD({ width: 1920, height: 1080 })).toBe(false);
    expect(isVerifiedUHD(undefined)).toBe(false);
  });

  it('tags sports from names (heuristic) and kids only from categories', () => {
    expect(sportsFromName('Test Cricket Channel')).toEqual(['cricket']);
    expect(sportsFromName('Example Sports', ['Example Football TV'])).toEqual(['football']);
    expect(sportsFromName('Example News')).toEqual([]);
    expect(isKidsByCategory(['kids'])).toBe(true);
    expect(isKidsByCategory(['entertainment'])).toBe(false);
  });

  it('fingerprints equivalent stream URLs identically', () => {
    const a = streamFingerprint('https://CDN.example.test:443/live/index.m3u8?b=2&a=1');
    const b = streamFingerprint('http://cdn.example.test/live/index.m3u8?a=1&b=2');
    const c = streamFingerprint('https://cdn.example.test/live/other.m3u8');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
