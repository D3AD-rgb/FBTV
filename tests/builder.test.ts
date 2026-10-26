// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildFromIptvOrg } from '../src/builder/iptvOrg.ts';
import { buildFromM3U, categoriesFromGroup } from '../src/builder/m3uSource.ts';
import { mergeChannels } from '../src/builder/merge.ts';
import { applyProbes, parseFfprobe, selectForProbe, type ProbeDb } from '../src/builder/probe.ts';
import { decodeChannels, encodeChannels } from '../src/shared/codec.ts';
import { parseM3U } from '../src/shared/m3u.ts';
import { checkSourceUrl, redactUrl } from '../src/shared/url.ts';
import { IPTVORG_FIXTURE } from './fixtures/iptvorg.ts';

const built = buildFromIptvOrg(IPTVORG_FIXTURE);
const byId = (id: string) => built.channels.filter((c) => c.id === id)[0];

describe('buildFromIptvOrg', () => {
  it('drops blocklisted, closed, header-only, DASH, non-HTTP, orphan and duplicate entries', () => {
    expect(byId('Blocked.uk')).toBeUndefined();
    expect(byId('Closed.fr')).toBeUndefined();
    expect(built.dropped).toMatchObject({
      blocklisted: 1,
      'channel-closed': 1,
      'needs-headers': 1,
      dash: 1,
      'unsupported-protocol': 1,
      'stream-without-channel': 1,
      'duplicate-url': 1,
    });
  });

  it('keeps regional feeds as separate streams, main feed first', () => {
    const one = byId('TestOne.uk')!;
    expect(one.streams.map((s) => s.feed)).toEqual(['London', 'Scotland']);
    expect(one.streams[1]!.feedName).toBe('Scotland');
    expect(one.streams[0]!.labels).toEqual(['Geo-blocked']);
  });

  it('takes languages from feeds and picks the channel-level in-use logo', () => {
    expect(byId('TestSport.sa')!.languages).toEqual(['ara']);
    expect(byId('TestOne.uk')!.logo).toBe('https://img.example.test/one.png');
    expect(byId('TestNews.uk')!.logo).toBe('https://img.example.test/news.png');
  });

  it('keeps advertised quality without marking anything verified', () => {
    const s = byId('TestSport.sa')!.streams[0]!;
    expect(s.quality).toBe('2160p');
    expect(s.probe).toBeUndefined();
  });

  it('tags kids only from categories, and sports by name only for sports channels', () => {
    expect(byId('TestKids.us')!.kids).toBe(true);
    expect(byId('KidsInName.us')!.kids).toBeUndefined();
    expect(byId('TestSport.sa')!.sports).toEqual(['football']);
    expect(byId('TestSport.sa')!.sportsBy).toBe('name');
  });

  it('lists only countries, languages and categories that are actually used', () => {
    expect(built.countries.map((c) => c.code).sort()).toEqual(['SA', 'UK', 'US']);
    expect(built.categories.map((c) => c.id)).not.toContain('movies');
  });
});

// TEST DATA — synthetic user playlist.
const PLAYLIST = parseM3U(
  [
    '#EXTM3U',
    '#EXTINF:-1 tvg-id="TestNews.uk@SD" group-title="News",Test News Mirror',
    'https://mirror.example.test/news.m3u8',
    '#EXTINF:-1 tvg-id="TestNews.uk@SD",Duplicate of iptv-org URL',
    'https://cdn.example.test/news.m3u8',
    '#EXTINF:-1 group-title="Kids",My Cartoons',
    'https://mirror.example.test/cartoons.m3u8',
    '#EXTINF:-1 group-title="Sports" tvg-country="GB",Local Cricket HD',
    'https://mirror.example.test/cricket.m3u8',
  ].join('\n'),
).entries;

describe('buildFromM3U + mergeChannels', () => {
  const known = new Set(built.channels.map((c) => c.id));
  const own = buildFromM3U(PLAYLIST, { id: 'mine', defaults: { country: 'UK', languages: ['eng'] } }, known);

  it('attaches entries to known channel ids and creates ids for the rest', () => {
    expect(own.channels.map((c) => c.id).sort()).toEqual(['TestNews.uk', 'src:mine:local-cricket.uk', 'src:mine:my-cartoons.uk']);
  });

  it('uses group titles as category hints but never as a kids signal', () => {
    expect(categoriesFromGroup('UK | News HD')).toEqual(['news']);
    const cartoons = own.channels.filter((c) => c.id === 'src:mine:my-cartoons.uk')[0]!;
    expect(cartoons.categories).toEqual(['kids']);
    expect(cartoons.kids).toBeUndefined();
  });

  it('merges by id, removes cross-source duplicate URLs, fills only missing fields', () => {
    const m = mergeChannels([built.channels, own.channels]);
    const news = m.channels.filter((c) => c.id === 'TestNews.uk')[0]!;
    expect(news.streams.map((s) => s.url)).toEqual([
      'https://cdn.example.test/news.m3u8',
      'https://mirror.example.test/news.m3u8',
    ]);
    expect(news.sources).toEqual(['iptv-org', 'mine']);
    expect(news.logo).toBe('https://img.example.test/news.png');
    expect(m.duplicates).toBe(1);
  });

  it('applies overrides, hiding and the kids allow/block lists', () => {
    const m = mergeChannels([built.channels, own.channels], {
      channels: { 'TestOne.uk': { name: 'Test One (fixed)', sports: ['rugby'] }, 'TestNews.uk': { hidden: true } },
      kidsAllowlist: ['src:mine:my-cartoons.uk'],
      kidsBlocklist: ['TestKids.us'],
    });
    const get = (id: string) => m.channels.filter((c) => c.id === id)[0];
    expect(get('TestOne.uk')!.name).toBe('Test One (fixed)');
    expect(get('TestOne.uk')!.sportsBy).toBe('override');
    expect(get('TestNews.uk')).toBeUndefined();
    expect(get('src:mine:my-cartoons.uk')!.kidsBy).toBe('allowlist');
    expect(get('TestKids.us')!.kids).toBeUndefined();
    expect(m.hidden).toBe(1);
  });
});

describe('codec', () => {
  it('round-trips the catalogue while dropping reconstructable fields', () => {
    const m = mergeChannels([built.channels]).channels;
    const wire = encodeChannels(JSON.parse(JSON.stringify(m)));
    expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(m).length);
    expect(wire[0]).not.toHaveProperty('sources');
    expect(decodeChannels(JSON.parse(JSON.stringify(wire)))).toEqual(m);
  });
});

describe('probe', () => {
  it('parses ffprobe output and picks the largest video stream', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'video', codec_name: 'h264', width: 1280, height: 720 },
        { codec_type: 'video', codec_name: 'hevc', width: 3840, height: 2160 },
        { codec_type: 'audio', codec_name: 'aac' },
        { codec_type: 'audio', codec_name: 'ac3' },
      ],
    });
    expect(parseFfprobe(json)).toEqual({ ok: true, width: 3840, height: 2160, videoCodec: 'hevc', audioCodecs: ['aac', 'ac3'] });
    expect(parseFfprobe('{"streams":[]}').ok).toBe(false);
  });

  it('selects never-probed then oldest streams, bounded per run', () => {
    const channels = mergeChannels([built.channels]).channels;
    const now = Date.parse('2026-10-25T00:00:00Z');
    const allIds = channels.flatMap((c) => c.streams.map((s) => s.id));
    const db: ProbeDb = { [allIds[0]!]: { ok: true, at: '2026-10-24T00:00:00Z' } };
    const pick = selectForProbe(channels, db, 3, now, 14);
    expect(pick).toHaveLength(3);
    expect(pick.map((p) => p.id)).not.toContain(allIds[0]);
  });

  it('only a successful probe produces verified resolution', () => {
    const channels = mergeChannels([built.channels]).channels;
    const sport = channels.filter((c) => c.id === 'TestSport.sa')[0]!;
    const news = channels.filter((c) => c.id === 'TestNews.uk')[0]!;
    applyProbes(channels, {
      [sport.streams[0]!.id]: { ok: true, at: '2026-10-25T00:00:00Z', width: 1920, height: 1080, videoCodec: 'h264' },
      [news.streams[0]!.id]: { ok: false, at: '2026-10-25T00:00:00Z', error: 'HTTP 403' },
    });
    expect(sport.streams[0]!.probe).toMatchObject({ width: 1920, height: 1080 });
    expect(sport.streams[0]!.quality).toBe('2160p'); // advertised value is kept, separately
    expect(news.streams[0]!.status).toBe('offline');
    expect(news.streams[0]!.probe).toBeUndefined();
  });
});

describe('checkSourceUrl', () => {
  it('accepts https and rejects unsafe or credential-bearing URLs', () => {
    expect(checkSourceUrl('https://iptv-org.github.io/api/').ok).toBe(true);
    expect(checkSourceUrl('http://example.test/a.m3u').ok).toBe(false);
    expect(checkSourceUrl('http://example.test/a.m3u', { allowHttp: true }).ok).toBe(true);
    expect(checkSourceUrl('javascript:alert(1)').ok).toBe(false);
    expect(checkSourceUrl('file:///etc/passwd').ok).toBe(false);
    expect(checkSourceUrl('https://user:pass@example.test/list.m3u').reason).toMatch(/username or password/);
    expect(checkSourceUrl('https://192.168.1.10/list.m3u').ok).toBe(false);
    expect(checkSourceUrl('https://192.168.1.10/list.m3u', { allowPrivate: true }).ok).toBe(true);
    expect(checkSourceUrl('https://exa mple.test/').ok).toBe(false);
  });

  it('redacts credentials and query tokens in logs', () => {
    expect(redactUrl('https://u:p@x.test/a.m3u?token=secret')).toBe('https://***@x.test/a.m3u?…');
  });
});
