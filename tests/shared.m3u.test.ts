// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseAttributes, parseM3U, splitTitle } from '../src/shared/m3u.ts';

// TEST DATA — synthetic playlist, not real channels or working streams.
const SAMPLE = [
  '﻿#EXTM3U x-tvg-url="https://epg.example.test/guide.xml.gz"',
  '#EXTINF:-1 tvg-id="TestNews.uk@SD" tvg-logo="https://img.example.test/n.png" group-title="News",Test News (1080p) [Geo-blocked]',
  'https://streams.example.test/news/index.m3u8',
  '#EXTINF:-1 tvg-id="Comma.us" tvg-name="Comma, Inc",Comma, The Channel',
  '#EXTVLCOPT:http-user-agent=TestAgent/1.0',
  '#EXTVLCOPT:http-referrer=https://site.example.test/',
  'https://streams.example.test/comma.m3u8',
  '#EXTINF:-1 group-title=Sports tvg-id=NoQuotes.fr,No Quotes',
  'https://streams.example.test/nq.ts',
  '#EXTINF:-1,Missing URL',
  '#EXTINF:-1,Orphan follows',
  'not a url',
  'https://streams.example.test/bare.m3u8',
].join('\r\n');

describe('parseM3U', () => {
  const r = parseM3U(SAMPLE);

  it('reads header EPG urls and strips the BOM', () => {
    expect(r.epgUrls).toEqual(['https://epg.example.test/guide.xml.gz']);
  });

  it('parses attributes, titles and groups', () => {
    const e = r.entries[0]!;
    expect(e.attrs['tvg-id']).toBe('TestNews.uk@SD');
    expect(e.attrs['tvg-logo']).toBe('https://img.example.test/n.png');
    expect(e.group).toBe('News');
    expect(e.title).toBe('Test News (1080p) [Geo-blocked]');
    expect(e.url).toBe('https://streams.example.test/news/index.m3u8');
  });

  it('keeps commas inside quoted attributes and in titles', () => {
    const e = r.entries[1]!;
    expect(e.attrs['tvg-name']).toBe('Comma, Inc');
    expect(e.title).toBe('Comma, The Channel');
  });

  it('captures header requirements from EXTVLCOPT', () => {
    expect(r.entries[1]!.userAgent).toBe('TestAgent/1.0');
    expect(r.entries[1]!.referrer).toBe('https://site.example.test/');
    expect(r.entries[0]!.userAgent).toBeUndefined();
  });

  it('accepts unquoted attribute values', () => {
    expect(r.entries[2]!.attrs['tvg-id']).toBe('NoQuotes.fr');
    expect(r.entries[2]!.group).toBe('Sports');
  });

  it('warns about broken entries and still keeps bare URLs', () => {
    expect(r.warnings.some((w) => /without a URL/.test(w))).toBe(true);
    expect(r.warnings.some((w) => /not a URL/.test(w))).toBe(true);
    expect(r.entries[r.entries.length - 1]!.url).toBe('https://streams.example.test/bare.m3u8');
  });

  it('caps the number of entries and overlong lines', () => {
    const many = '#EXTM3U\n' + Array.from({ length: 50 }, (_, i) => `#EXTINF:-1,C${i}\nhttps://x.test/${i}.m3u8`).join('\n');
    const capped = parseM3U(many, { maxEntries: 10 });
    expect(capped.entries).toHaveLength(10);
    expect(capped.warnings.some((w) => /stopped after 10/.test(w))).toBe(true);
    const long = parseM3U('#EXTM3U\n#EXTINF:-1,A\nhttps://x.test/' + 'a'.repeat(10000), { maxLineLength: 1000 });
    expect(long.entries).toHaveLength(0);
  });
});

describe('parseAttributes / splitTitle', () => {
  it('lower-cases keys and keeps the first occurrence', () => {
    expect(parseAttributes('TVG-ID="a" tvg-id="b" x=1')).toEqual({ 'tvg-id': 'a', x: '1' });
  });

  it('splits iptv-org title decorations', () => {
    expect(splitTitle('Test News (1080p) [Geo-blocked] [Not 24/7]')).toEqual({
      name: 'Test News',
      quality: '1080p',
      labels: ['Geo-blocked', 'Not 24/7'],
    });
    expect(splitTitle('Plain Name')).toEqual({ name: 'Plain Name', quality: undefined, labels: [] });
  });
});
