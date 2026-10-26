// @vitest-environment node
// TEST DATA — every channel, URL, path and account below is synthetic.
import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parsePlaylist } from '../src/shared/m3u.ts';
import type { InventoryRecord, RecordMeta } from '../src/library/inventory.ts';
import { COLLECTIONS, discoverSourcePlaylists, playlistId, playlistM3U, writeSourcePlaylists } from '../src/library/sourcePlaylists.ts';
import { beginOutputs, finishOutputs, isOwnedPath, planCleanup, trackOutput, writeOutput } from '../src/library/outputs.ts';
import { m3uPairs, mergeM3U, writeCustomPlaylists } from '../src/library/customPlaylists.ts';
import { exportForTv, isPrivateClient, readSettings, validSettings, writeSettings, type PlaylistSettings } from '../src/library/export.ts';
import { mediaId, parseMediaName, publicMedia, scanLocalMedia, srtToVtt, writeLocalMedia } from '../src/library/localMedia.ts';
import { loadPrivateRefs, privateRef, resetPrivateRefs, savePrivateRefs } from '../src/library/privateUrls.ts';
import type { Registry } from '../src/library/catalogs.ts';

const NOW = '2026-10-26T00:00:00.000Z';
const meta = (over: Partial<RecordMeta> = {}): RecordMeta => ({
  languages: [],
  languageSource: 'none',
  categories: [],
  labels: [],
  sports: [],
  restrictions: [],
  ...over,
});
let uid = 0;
const rec = (repo: string, file: string, line: number, name: string, url: string | null, over: Partial<InventoryRecord> = {}): InventoryRecord => ({
  uid: `r${++uid}`,
  kind: 'stream',
  name,
  url,
  source: { repo, file, line, originUrl: `https://example.test/${repo}/${file}`, permission: 'unclear', handling: 'copy' },
  meta: meta(),
  importedAt: NOW,
  status: 'imported',
  reasons: [],
  validation: 'untested',
  ...over,
});

const tmp: string[] = [];
const tempDir = () => {
  const d = mkdtempSync(join(tmpdir(), 'fbtv-pl-'));
  tmp.push(d);
  return d;
};
afterEach(() => {
  while (tmp.length) rmSync(tmp.pop()!, { recursive: true, force: true });
});

// One synthetic record per supplied collection, plus My Playlist, jromero88 and the Archive.
const REPOS: [string, string][] = [
  ['iptv-org', 'streams/uk.m3u'],
  ['my-tv', 'app/channels.json'],
  ['tvlist-awesome', 'm3u/sports.m3u'],
  ['fanmingming-live', 'tv/m3u/ipv6.m3u'],
  ['iptv-api', 'output/result.m3u'],
  ['zhuiju-free', 'README.md'],
  ['awesome-iptv', 'README.md'],
  ['free-tv', 'playlist.m3u8'],
  ['iptv-sources', 'cn.m3u'],
  ['iptvnator', 'test/playlist.m3u'],
  ['profile:home', 'profile'],
  ['jromero88', 'lists/sports.m3u'],
  ['internet-archive', 'films-eng'],
];

describe('source playlist discovery', () => {
  const records = REPOS.map(([repo, file], i) => rec(repo, file, 3, `Channel ${i}`, `https://cdn.test/${i}/index.m3u8`, { channelKey: `chan${i}.test` }));
  const res = discoverSourcePlaylists(records, { home: 'Home provider' });

  it('finds the nine supplied collections and My Playlist, each keeping its identity', () => {
    const supplied = COLLECTIONS.filter((c) => c.supplied).map((c) => c.id);
    expect(supplied).toEqual(['iptv-org', 'my-tv', 'tvlist-awesome', 'fanmingming-live', 'iptv-api', 'zhuiju-free', 'awesome-iptv', 'iptv-sources', 'iptvnator']);
    for (const id of supplied.concat(['my-playlist', 'jromero88', 'internet-archive'])) {
      const col = res.collections.filter((c) => c.id === id)[0]!;
      expect(col, id).toBeTruthy();
      expect(col.playlists.length, id).toBeGreaterThan(0);
    }
    // awesome-iptv shows its own README and the Free-TV list it links to, as separate playlists.
    expect(res.collections.filter((c) => c.id === 'awesome-iptv')[0]!.playlists.length).toBe(2);
    const mine = res.playlists.filter((p) => p.collection === 'my-playlist')[0]!;
    expect(mine.title).toBe('Home provider');
  });

  it('gives each playlist a stable id from its source and file only', () => {
    expect(playlistId('iptv-org', 'streams/uk.m3u')).toBe(playlistId('iptv-org', 'streams/uk.m3u'));
    expect(playlistId('iptv-org', 'streams/uk.m3u')).not.toBe(playlistId('iptv-org', 'streams/us.m3u'));
    expect(playlistId('iptv-org', 'streams/uk.m3u')).toMatch(/^[0-9a-f]{12}$/);
    const again = discoverSourcePlaylists(records.slice().reverse(), { home: 'Home provider' });
    expect(again.playlists.map((p) => p.id).sort()).toEqual(res.playlists.map((p) => p.id).sort());
  });

  it('merges the same channel within a playlist, keeping every URL as an alternative', () => {
    const r = discoverSourcePlaylists([
      rec('iptv-org', 'streams/uk.m3u', 2, 'News One', 'https://a.test/1.m3u8', { channelKey: 'NewsOne.uk' }),
      rec('iptv-org', 'streams/uk.m3u', 4, 'News One HD', 'https://b.test/1.m3u8', { channelKey: 'NewsOne.uk' }),
      rec('iptv-org', 'streams/uk.m3u', 6, 'News One', 'https://a.test/1.m3u8', { channelKey: 'NewsOne.uk' }),
      rec('iptv-org', 'streams/uk.m3u', 8, 'Other', 'https://c.test/2.m3u8'),
    ]);
    const p = r.playlists[0]!;
    const list = r.entries.get(p.id)!;
    expect(list.length).toBe(2);
    expect(list[0]!.u).toEqual(['https://a.test/1.m3u8', 'https://b.test/1.m3u8']);
    expect(p.duplicates).toBe(2);
    expect(p.playable).toBe(2);
  });

  it('separates live and on-demand entries and keeps unplayable ones with a reason', () => {
    const r = discoverSourcePlaylists([
      rec('internet-archive', 'films-eng', 1, 'A Film', 'https://archive.test/film.mp4', { kind: 'vod' }),
      rec('iptv-org', 'streams/uk.m3u', 2, 'Live', 'https://a.test/live.m3u8'),
      rec('iptv-org', 'streams/uk.m3u', 3, 'Relay', null, { status: 'restricted', reasons: ['paid relay'] }),
      rec('iptv-org', 'streams/uk.m3u', 4, 'RTMP', 'rtmp://a.test/x', { status: 'unsupported_format' }),
      rec('iptv-org', 'streams/uk.m3u', 5, '', null, { kind: 'malformed-line', status: 'malformed' }),
    ]);
    const film = r.entries.get(r.playlists.filter((p) => p.collection === 'internet-archive')[0]!.id)!;
    expect(film[0]!.vod).toBe(1);
    const uk = r.playlists.filter((p) => p.collection === 'iptv-org')[0]!;
    const list = r.entries.get(uk.id)!;
    expect(list.map((e) => e.s)).toEqual(['ok', 'withheld', 'unsupported', 'malformed']);
    expect(list[0]!.vod).toBeUndefined();
    expect(list[1]!.u).toBeUndefined(); // a withheld link never reaches the TV
    expect(list[1]!.why).toBe('paid relay');
    expect(uk.withheld).toBe(1);
    expect(uk.malformed).toBe(1);
  });

  it('writes M3U that parses back with every alternative URL', () => {
    const p = res.playlists.filter((x) => x.collection === 'iptv-org')[0]!;
    const text = playlistM3U(p, res.entries.get(p.id)!);
    const parsed = parsePlaylist(text);
    expect(parsed.entries.map((e) => e.url)).toEqual(['https://cdn.test/0/index.m3u8']);
    expect(parsed.entries[0]!.attrs['tvg-id']).toBe('chan0.test');
  });

  it('exports My Playlist with private references only: no URL, path or file name', () => {
    resetPrivateRefs();
    const dir = tempDir();
    const exp = join(dir, 'export');
    mkdirSync(join(exp, 'playlists'), { recursive: true });
    const secret = 'http://provider.test:8080/live/someuser/somepass/1.ts';
    const r = discoverSourcePlaylists([rec('profile:home', 'C:\\Users\\me\\lists\\home.m3u', 1, 'Mine', secret)], { home: 'Home' });
    beginOutputs(dir);
    writeSourcePlaylists(dir, exp, r);
    const id = r.playlists[0]!.id;
    const tv = readFileSync(join(exp, 'playlists', `${id}.json`), 'utf8');
    const index = readFileSync(join(exp, 'playlists', 'index.json'), 'utf8');
    for (const text of [tv, index]) {
      expect(text).not.toContain('someuser');
      expect(text).not.toContain('somepass');
      expect(text).not.toContain('C:\\\\Users');
      expect(text).not.toContain('home.m3u');
    }
    expect(JSON.parse(tv).entries[0].u[0]).toMatch(/^@play\/[0-9a-f]{24}$/);
    // The PC keeps the map so the server can resolve the token.
    savePrivateRefs(dir);
    const token = JSON.parse(tv).entries[0].u[0].slice(6);
    expect(loadPrivateRefs(dir).get(token)).toBe(secret);
  });
});

describe('generated-output ownership and cleanup', () => {
  it('only plans removal of files an earlier run recorded, inside the output folders', () => {
    const plan = planCleanup(
      ['playlists/source-playlists/a.m3u', 'playlists/source-playlists/b.m3u', 'playlists/my-playlist/mine.m3u', 'media/movies/x.mp4', 'catalogs/inventory.jsonl', '../outside.txt'],
      new Set(['playlists/source-playlists/a.m3u']),
    );
    expect(plan.remove).toEqual(['playlists/source-playlists/b.m3u']);
    expect(plan.protected).toContain('playlists/my-playlist/mine.m3u');
    expect(plan.protected).toContain('media/movies/x.mp4');
    expect(isOwnedPath('playlists/custom-user/x.m3u')).toBe(false);
    expect(isOwnedPath('generated/profiles/p.json')).toBe(false);
    expect(isOwnedPath('C:/Users/x')).toBe(false);
  });

  function build(dir: string, files: string[], dryRun = false) {
    beginOutputs(dir);
    for (const f of files) writeOutput(join(dir, f), 'x');
    return finishOutputs(dir, () => undefined, { dryRun });
  }

  it('never deletes user files, media, profiles or unrecorded files; dry run deletes nothing', () => {
    const dir = tempDir();
    const user = ['playlists/my-playlist/mine.m3u', 'playlists/custom-user/fav.m3u', 'media/movies/Film (2001).mp4', 'provider-profiles/profiles.local.json', 'settings/playlists.json', 'playlists/source-playlists/put-there-by-me.m3u'];
    for (const f of user) {
      mkdirSync(join(dir, f, '..'), { recursive: true });
      writeFileSync(join(dir, f), 'mine');
    }
    build(dir, ['playlists/source-playlists/a.m3u', 'playlists/source-playlists/b.m3u', 'catalogs/x.json']);
    // Next run no longer produces b.m3u: dry run reports it and keeps it.
    const dry = build(dir, ['playlists/source-playlists/a.m3u', 'catalogs/x.json'], true);
    expect(dry.remove).toEqual(['playlists/source-playlists/b.m3u']);
    expect(existsSync(join(dir, 'playlists/source-playlists/b.m3u'))).toBe(true);
    expect(existsSync(join(dir, 'reports/cleanup-dry-run.md'))).toBe(true);
    // A real run removes only b.m3u.
    const real = build(dir, ['playlists/source-playlists/a.m3u', 'catalogs/x.json']);
    expect(real.remove).toEqual(['playlists/source-playlists/b.m3u']);
    expect(existsSync(join(dir, 'playlists/source-playlists/b.m3u'))).toBe(false);
    expect(existsSync(join(dir, 'playlists/source-playlists/a.m3u'))).toBe(true);
    for (const f of user) expect(readFileSync(join(dir, f), 'utf8'), f).toBe('mine');
  });

  it('records files written outside writeOutput too', () => {
    const dir = tempDir();
    beginOutputs(dir);
    mkdirSync(join(dir, 'catalogs'), { recursive: true });
    writeFileSync(join(dir, 'catalogs', 'y.json'), '{}');
    trackOutput(join(dir, 'catalogs', 'y.json'));
    finishOutputs(dir, () => undefined);
    const manifest = JSON.parse(readFileSync(join(dir, 'manifests/generated-files.json'), 'utf8'));
    expect(manifest.files).toEqual(['catalogs/y.json']);
  });
});

describe('custom playlists', () => {
  const pl = (title: string, pairs: [string, string][]) => ['#EXTM3U', ...pairs.flatMap(([n, u]) => [`#EXTINF:-1,${n}`, u])].join('\n');

  it('parses EXTINF/URL pairs and merges members without repeating a URL', () => {
    expect(m3uPairs('#EXTM3U\n#EXTINF:-1,A\nhttp://a.test/1\n# comment\n\n#EXTINF:-1,B\r\nhttp://b.test/2\r\n')).toEqual([
      ['#EXTINF:-1,A', 'http://a.test/1'],
      ['#EXTINF:-1,B', 'http://b.test/2'],
    ]);
    const merged = mergeM3U('Mix', [pl('1', [['A', 'http://a.test/1'], ['B', 'http://b.test/2']]), pl('2', [['A again', 'http://a.test/1'], ['C', 'http://c.test/3']])]);
    expect(m3uPairs(merged).map((p) => p[1])).toEqual(['http://a.test/1', 'http://b.test/2', 'http://c.test/3']);
    expect(merged).toContain('#PLAYLIST:Mix');
  });

  it('rebuilds named playlists from current members and reports missing ones without dropping them', () => {
    const dir = tempDir();
    const r = discoverSourcePlaylists([rec('iptv-org', 'streams/uk.m3u', 1, 'A', 'https://a.test/1.m3u8'), rec('iptv-sources', 'cn.m3u', 1, 'B', 'https://b.test/2.m3u8')]);
    const [p1, p2] = r.playlists;
    const settings: PlaylistSettings = {
      version: 1,
      updatedAt: NOW,
      selected: [`src:${p1!.id}`],
      saved: null,
      custom: [{ id: 'c1', name: 'Evening mix', members: [`src:${p1!.id}`, `src:${p2!.id}`, 'src:gone00000000'], createdAt: NOW, updatedAt: NOW }],
    };
    beginOutputs(dir);
    const out = writeCustomPlaylists(dir, r, { items: [] } as unknown as Registry, settings);
    finishOutputs(dir, () => undefined);
    expect(out.map((o) => o.file)).toEqual(['playlists/custom/my-selection.m3u', 'playlists/custom/evening-mix.m3u']);
    expect(out[1]!.missing).toEqual(['src:gone00000000']);
    expect(m3uPairs(readFileSync(join(dir, 'playlists/custom/evening-mix.m3u'), 'utf8')).map((p) => p[1])).toEqual(['https://a.test/1.m3u8', 'https://b.test/2.m3u8']);
    // The definition (settings) is untouched by a rebuild.
    expect(settings.custom[0]!.members.length).toBe(3);
  });
});

describe('playlist settings (from the TV)', () => {
  const ok: PlaylistSettings = { version: 1, updatedAt: NOW, selected: ['src:abc'], saved: { selected: ['src:abc'], savedAt: NOW }, custom: [{ id: 'c1', name: 'Mine', members: ['src:abc', 'lib:country-uk'], createdAt: NOW, updatedAt: NOW }] };

  it('accepts a well-formed document and rejects anything else', () => {
    expect(validSettings(ok)).toBe(true);
    expect(validSettings({ ...ok, version: 2 })).toBe(false);
    expect(validSettings({ ...ok, selected: 'src:abc' })).toBe(false);
    expect(validSettings({ ...ok, selected: [1] })).toBe(false);
    expect(validSettings({ ...ok, custom: [{ ...ok.custom[0]!, name: '' }] })).toBe(false);
    expect(validSettings({ ...ok, custom: [{ ...ok.custom[0]!, name: 'x'.repeat(121) }] })).toBe(false);
    expect(validSettings(null)).toBe(false);
  });

  it('survives a rebuild: writes atomically with a backup and reads back', () => {
    const dir = tempDir();
    writeSettings(dir, ok);
    writeSettings(dir, { ...ok, selected: [] });
    expect(readSettings(dir)!.selected).toEqual([]);
    expect(JSON.parse(readFileSync(join(dir, 'settings/playlists.json.bak'), 'utf8')).selected).toEqual(['src:abc']);
    // A library rebuild only writes inside its own output folders.
    beginOutputs(dir);
    writeOutput(join(dir, 'catalogs', 'z.json'), '{}');
    finishOutputs(dir, () => undefined);
    expect(readSettings(dir)!.custom[0]!.name).toBe('Mine');
  });
});

describe('library server access', () => {
  it('serves only loopback and private-network clients', () => {
    for (const a of ['127.0.0.1', '::1', '192.168.0.160', '::ffff:192.168.0.160', '10.1.2.3', '172.16.0.9', '172.31.255.1', 'fd12:3456::1', 'fe80::1']) expect(isPrivateClient(a), a).toBe(true);
    for (const a of ['8.8.8.8', '::ffff:8.8.8.8', '172.32.0.1', '2001:db8::1', '100.64.0.1', '', undefined]) expect(isPrivateClient(a), String(a)).toBe(false);
  });
});

describe('TV export', () => {
  const prev = process.env.FBTV_LIBRARY_EXPORT;
  afterEach(() => {
    if (prev === undefined) delete process.env.FBTV_LIBRARY_EXPORT;
    else process.env.FBTV_LIBRARY_EXPORT = prev;
  });
  const registry = { generatedAt: NOW, groups: [], items: [] } as unknown as Registry;

  it('keeps the previous export when a build fails', () => {
    const dir = tempDir();
    const out = join(dir, 'export');
    process.env.FBTV_LIBRARY_EXPORT = out;
    exportForTv(dir, [], registry, (staging) => writeFileSync(join(staging, 'marker.json'), '"first"'));
    expect(readFileSync(join(out, 'marker.json'), 'utf8')).toBe('"first"');
    expect(() =>
      exportForTv(dir, [], registry, () => {
        throw new Error('boom');
      }),
    ).toThrow(/previous export is unchanged/);
    expect(readFileSync(join(out, 'marker.json'), 'utf8')).toBe('"first"');
    expect(existsSync(`${out}.staging`)).toBe(false);
    // A good build replaces it and keeps one previous copy.
    exportForTv(dir, [], registry, (staging) => writeFileSync(join(staging, 'marker.json'), '"second"'));
    expect(readFileSync(join(out, 'marker.json'), 'utf8')).toBe('"second"');
    expect(readFileSync(join(`${out}.previous`, 'marker.json'), 'utf8')).toBe('"first"');
  });

  it('contains no secrets, private paths or provider URLs', () => {
    resetPrivateRefs();
    const dir = tempDir();
    const out = join(dir, 'export');
    process.env.FBTV_LIBRARY_EXPORT = out;
    const secretUrl = 'http://provider.test:8080/live/someuser/somepass/7.ts';
    const r = discoverSourcePlaylists([rec('profile:home', 'C:\\Users\\me\\FBTV-local-data\\lists\\home.m3u', 1, 'Mine', secretUrl), rec('iptv-org', 'streams/uk.m3u', 1, 'A', 'https://a.test/1.m3u8')], { home: 'Home' });
    mkdirSync(join(dir, 'media', 'movies'), { recursive: true });
    writeFileSync(join(dir, 'media', 'movies', 'Heat (1995).mp4'), 'x');
    writeFileSync(join(dir, 'media', 'movies', 'Heat (1995).en.srt'), '1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    mkdirSync(join(dir, 'catalogs'), { recursive: true });
    beginOutputs(dir);
    exportForTv(dir, [], registry, (staging) => {
      mkdirSync(join(staging, 'playlists'), { recursive: true });
      writeSourcePlaylists(dir, staging, r);
      writeLocalMedia(dir, staging, scanLocalMedia(dir));
    });
    finishOutputs(dir, () => undefined);
    const texts: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else texts.push(readFileSync(p, 'utf8'));
      }
    };
    walk(out);
    const all = texts.join('\n');
    expect(all).toContain('https://a.test/1.m3u8'); // public sources are fine
    expect(all).toContain('Heat');
    for (const bad of ['someuser', 'somepass', 'provider.test', 'FBTV-local-data', 'C:\\\\', dir.replace(/\\/g, '\\\\'), '"path"', '"artPath"', 'password', 'home.m3u']) {
      expect(all.indexOf(bad), bad).toBe(-1);
    }
  });
});

describe('local media', () => {
  it('reads titles, years, series, seasons and episodes from Windows and POSIX paths', () => {
    expect(parseMediaName('movies\\Heat (1995).mkv')).toEqual({ kind: 'movie', title: 'Heat', year: 1995 });
    expect(parseMediaName('movies/The.Third.Man.1949.1080p.mp4')).toMatchObject({ kind: 'movie', title: 'The Third Man', year: 1949 });
    expect(parseMediaName('series\\Line of Duty\\Season 2\\Line.of.Duty.S02E03.mkv')).toMatchObject({ kind: 'episode', series: 'Line of Duty', season: 2, episode: 3 });
    expect(parseMediaName('series/Sherlock/Sherlock 1x02 The Blind Banker.mp4')).toMatchObject({ kind: 'episode', series: 'Sherlock', season: 1, episode: 2, title: 'The Blind Banker' });
    expect(parseMediaName('other/Show S01E05.mp4')).toMatchObject({ kind: 'episode', series: 'Show', season: 1, episode: 5 });
    expect(parseMediaName('other/holiday clip.mp4')).toMatchObject({ kind: 'other', title: 'holiday clip' });
  });

  it('gives a stable id regardless of slash direction and case', () => {
    expect(mediaId('movies\\Heat (1995).mkv')).toBe(mediaId('movies/heat (1995).mkv'));
    expect(mediaId('movies/a.mp4')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('finds videos with sidecar subtitles and artwork; the TV copy has no paths', () => {
    const dir = tempDir();
    const m = join(dir, 'media', 'series', 'Show', 'Season 1');
    mkdirSync(m, { recursive: true });
    for (const f of ['Show S01E02.mkv', 'Show S01E01.mp4', 'Show S01E01.en.srt', 'Show S01E01.fr.vtt', 'poster.jpg', 'notes.txt']) writeFileSync(join(m, f), 'x');
    const items = scanLocalMedia(dir);
    expect(items.map((i) => i.episode)).toEqual([1, 2]);
    expect(items[0]!.subtitles.map((s) => s.label)).toEqual(['EN', 'FR']);
    expect(items[0]!.art).toBe(true);
    expect(existsSync(join(dir, 'media', 'movies'))).toBe(true);
    const pub = JSON.stringify(publicMedia(items));
    expect(pub).not.toContain(dir.replace(/\\/g, '\\\\'));
    expect(pub).not.toContain('"path"');
  });

  it('converts SubRip to WebVTT', () => {
    expect(srtToVtt('\uFEFF1\r\n00:00:01,500 --> 00:00:03,000\r\nHello\r\n\r\n2\r\n00:00:04,000 --> 00:00:05,250\r\nBye\r\n')).toBe(
      'WEBVTT\n\n00:00:01.500 --> 00:00:03.000\nHello\n\n00:00:04.000 --> 00:00:05.250\nBye\n',
    );
  });
});

describe('private references', () => {
  it('are stable per URL and reveal nothing of it', () => {
    resetPrivateRefs();
    const a = privateRef('http://p.test/u/p/1.ts');
    expect(privateRef('http://p.test/u/p/1.ts')).toBe(a);
    expect(a).not.toContain('p.test');
    expect(privateRef('http://p.test/u/p/2.ts')).not.toBe(a);
  });
});
