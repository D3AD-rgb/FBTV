// @vitest-environment node
// TEST DATA — every channel, URL, team and account below is synthetic.
import { describe, expect, it } from 'vitest';
import { parsePlaylist, parseTxtPlaylist, type M3UEntry } from '../src/shared/m3u.ts';
import { classifyStream, markDuplicates, parseMyTvList, providerAccountUrl, type SourceCtx } from '../src/library/inventory.ts';
import { buildChannels } from '../src/library/catalogs.ts';
import { footballRole, sportsOf, fixturePriority, isBigClub, sameTeam, PAY_TV_RELAY } from '../src/library/policy.ts';
import { zonedToUtc, parseOpenfootball, parseFootballTxt, sameMatch, fromTsdbEvent, roundLabel, roundsToFetch, TSDB_LEAGUES, OPENFOOTBALL } from '../src/library/fixtures.ts';
import { detectCapabilities, importVod, languageFor, playUrl, type Fetcher } from '../src/library/xtream.ts';
import { maskSecrets } from '../src/library/secrets.ts';
import { compact, selectFor } from '../src/library/export.ts';
import { ARCHIVE_SETS, archiveEligible, playableFiles } from '../src/library/archive.ts';
import { isNews, isSports } from '../src/library/catalogs.ts';
import { adapt, applySelect, libStatus } from '../src/app/data/sourceLibrary.ts';
import type { XtreamProfile } from '../src/library/profiles.ts';

const NOW = '2026-10-26T00:00:00.000Z';
const ctx = (over: Partial<SourceCtx> = {}): SourceCtx => ({
  repo: 'tvlist-awesome',
  file: 'm3u/test.m3u',
  originUrl: 'https://example.test/repo/m3u/test.m3u',
  permission: 'unclear',
  handling: 'copy',
  category: 'live-tv',
  policy: 'keep',
  ...over,
});
const entry = (title: string, url: string, extra: Partial<M3UEntry> = {}): M3UEntry => ({ title, url, duration: -1, attrs: {}, line: 3, ...extra });

describe('inventory statuses (nothing dropped, reasons recorded)', () => {
  it('withholds paid-IPTV account URLs (credentials in the path), but not ordinary CDN paths', () => {
    expect(providerAccountUrl('http://reseller.test:41001/someuser/somepass/31991')).toBe(true);
    expect(providerAccountUrl('http://portal.test:80/live/u/p/31731.ts')).toBe(true);
    expect(providerAccountUrl('http://x.test/get.php?username=a&password=b&type=m3u')).toBe(true);
    expect(providerAccountUrl('https://cdn.test/hls/live/2003000/master.m3u8')).toBe(false);
    expect(providerAccountUrl('http://1.2.3.4:8080/hls/channel.m3u8')).toBe(false);
    const r = classifyStream(entry('Some Channel', 'http://reseller.test:41001/someuser/somepass/31991'), ctx(), null, NOW, 0);
    expect([r.status, r.url]).toEqual(['restricted', null]);
  });

  it('treats HTTP-FLV as live, and a media file or a duration as on demand', () => {
    expect(classifyStream(entry('Aneflix Live', 'https://cdn.test/play/live_a.flv'), ctx(), null, NOW, 0).kind).toBe('stream');
    expect(classifyStream(entry('A Film', 'https://cdn.test/films/a.mp4'), ctx(), null, NOW, 1).kind).toBe('vod');
    expect(classifyStream(entry('Episode', 'https://cdn.test/e/1.m3u8', { duration: 2700 }), ctx(), null, NOW, 2).kind).toBe('vod');
  });
  it('imports a normal stream with provenance', () => {
    const r = classifyStream(entry('Test News', 'https://cdn.example.test/news.m3u8'), ctx(), null, NOW);
    expect(r.status).toBe('imported');
    expect(r.url).toBe('https://cdn.example.test/news.m3u8');
    expect(r.source).toMatchObject({ repo: 'tvlist-awesome', file: 'm3u/test.m3u', line: 3 });
    expect(r.validation).toBe('untested');
  });

  it('keeps unsupported formats with the URL and the reason', () => {
    const rtmp = classifyStream(entry('A', 'rtmp://live.example.test/app'), ctx(), null, NOW);
    expect(rtmp.status).toBe('unsupported_format');
    expect(rtmp.url).toBe('rtmp://live.example.test/app');
    const hdr = classifyStream(entry('B', 'https://x.test/b.m3u8', { userAgent: 'X/1' }), ctx(), null, NOW);
    expect(hdr.status).toBe('unsupported_format');
    expect(hdr.reasons[0]).toMatch(/headers/);
  });

  it('marks ISP/LAN-only streams as requiring provider access', () => {
    const r = classifyStream(entry('Multicast', 'udp://239.1.1.1:5000'), ctx(), null, NOW);
    expect(r.status).toBe('unsupported_format'); // udp is also a non-HTTP protocol
    const lan = classifyStream(entry('LAN', 'http://192.168.1.2:4022/rtp/239.1.1.1:5000'), ctx(), null, NOW);
    expect(lan.status).toBe('requires_provider_access');
    expect(lan.url).toContain('192.168.1.2');
  });

  it('withholds only pay-TV relays in mixed relay sources, keeping the record', () => {
    const pay = classifyStream(entry('HBO Test', 'https://relay.example.test/hbo.m3u8'), ctx({ policy: 'withhold-pay' }), null, NOW);
    expect(pay.status).toBe('restricted');
    expect(pay.url).toBeNull();
    expect(pay.urlWithheldReason).toMatch(/pay-TV/);
    expect(pay.name).toBe('HBO Test');
    const free = classifyStream(entry('Free Local', 'https://relay.example.test/free.m3u8'), ctx({ policy: 'withhold-pay' }), null, NOW);
    expect(free.status).toBe('imported');
  });

  it('withholds every URL for withhold-all sources (hotel leaks, piracy, access bypass)', () => {
    const r = classifyStream(entry('Anything', 'https://hotel.example.test/1.m3u8'), ctx({ policy: 'withhold-all', reason: 'Leaked hotel IPTV gateways' }), null, NOW);
    expect(r.status).toBe('restricted');
    expect(r.url).toBeNull();
    expect(r.reasons).toEqual(['Leaked hotel IPTV gateways']);
  });

  it('withholds paid sports channels from every source, but keeps their free versions', () => {
    const iptvOrg = ctx({ repo: 'iptv-org', permission: 'open' });
    for (const name of ['beIN Sports 1', 'ESPN', 'Fox Sports', 'TUDN', 'Sky Sports Main Event', 'TNT Sports 1']) {
      const r = classifyStream(entry(name, 'https://cdn.example.test/b.m3u8', { group: 'Sports' }), iptvOrg, null, NOW);
      expect([name, r.status, r.url]).toEqual([name, 'restricted', null]);
    }
    for (const name of ['beIN SPORTS XTRA', 'ESPN8 The Ocho', 'CBS Sports Golazo Network', 'FIFA+']) {
      const r = classifyStream(entry(name, 'https://cdn.example.test/b.m3u8', { group: 'Sports' }), iptvOrg, null, NOW);
      expect([name, r.status]).toEqual([name, 'imported']);
    }
    // Your own provider profiles are yours to use.
    const own = classifyStream(entry('ESPN', 'https://provider.test/e.m3u8', { group: 'Sports' }), ctx({ repo: 'profile:me', permission: 'user' }), null, NOW);
    expect(own.status).toBe('imported');
  });

  it('only treats positive durations or media files as VOD (never group names)', () => {
    expect(classifyStream(entry('Film', 'https://x.test/film.mp4'), ctx(), null, NOW).kind).toBe('vod');
    expect(classifyStream(entry('Ep', 'https://x.test/e', { duration: 2700 }), ctx(), null, NOW).kind).toBe('vod');
    expect(classifyStream(entry('FAST Movies', 'https://x.test/live.m3u8', { group: 'VOD Movies (EN)' }), ctx(), null, NOW).kind).toBe('stream');
  });

  it('marks later copies as duplicate references, trusting iptv-org first', () => {
    const a = classifyStream(entry('X', 'https://cdn.example.test/x.m3u8'), ctx({ repo: 'tvlist-awesome' }), null, NOW);
    const b = classifyStream(entry('X', 'http://CDN.example.test/x.m3u8'), ctx({ repo: 'iptv-org', permission: 'open' }), null, NOW);
    const n = markDuplicates([a, b]);
    expect(n).toBe(1);
    expect(b.status).toBe('imported');
    expect(a.status).toBe('duplicate_reference');
    expect(a.duplicateOf).toBe(b.uid);
  });
});

describe('parsers', () => {
  it('parses TXT "name,url" playlists with #genre# groups and multi-URL lines', () => {
    const r = parseTxtPlaylist('央视,#genre#\nCCTV-1,http://a.test/1.m3u8#http://b.test/1.m3u8\nbroken line\nX,notaurl');
    expect(r.entries.map((e) => [e.title, e.url, e.group])).toEqual([
      ['CCTV-1', 'http://a.test/1.m3u8', '央视'],
      ['CCTV-1', 'http://b.test/1.m3u8', '央视'],
    ]);
    expect(r.warnings).toHaveLength(2);
  });

  it('auto-detects M3U vs TXT', () => {
    expect(parsePlaylist('#EXTM3U\n#EXTINF:-1,A\nhttps://x.test/a').format).toBe('m3u');
    expect(parsePlaylist('A,https://x.test/a').format).toBe('txt');
  });

  it('reads names, aliases, groups and logos from my-tv’s Kotlin list (no URLs exist)', () => {
    const kt = 'TV(\n  0,\n  "Test 1 综合",\n  "TEST1",\n  listOf(),\n  "央视",\n  "https://img.example.test/1.png",\n  "1", "2")';
    expect(parseMyTvList(kt)).toEqual([{ name: 'Test 1 综合', alias: 'TEST1', group: '央视', logo: 'https://img.example.test/1.png', line: 1 }]);
  });
});

describe('sports and football classification', () => {
  it('tags sports from names and groups', () => {
    expect(sportsOf('Test F1 Channel')).toContain('motorsport');
    expect(sportsOf('Example NBA TV')).toContain('basketball');
    expect(sportsOf('UFC Fight Pass Test')).toContain('combat');
    expect(sportsOf('Rally TV Test')).toContain('rally');
    expect(sportsOf('Cricket Test')).toContain('cricket');
    expect(sportsOf('Boxing Test TV')).toContain('boxing');
  });

  it('football roles: dedicated, club TV only for sports channels, broadcaster brands', () => {
    expect(footballRole('Test Football Channel', [], ['sports'], true)).toBe('dedicated');
    expect(footballRole('Real Madrid TV', [], ['sports'], true)).toBe('club');
    expect(footballRole('Roma TV 82', [], ['general'], false)).toBeNull(); // Rome local station
    expect(footballRole('Soccer Anthems', [], ['music'], false)).toBeNull(); // music channel
    expect(footballRole('Sky Sports Test', [], ['sports'], true)).toBe('broadcaster-brand');
  });

  it('pay-TV relay patterns cover international and Chinese pay channels', () => {
    for (const n of ['HBO Signature', 'CCTV风云足球', 'NewTV动作电影', 'TVB翡翠台']) expect(PAY_TV_RELAY.test(n)).toBe(true);
    expect(PAY_TV_RELAY.test('Local News 1')).toBe(false);
  });
});

describe('fixtures', () => {
  it('converts local kick-off to UTC across the UK clock change', () => {
    expect(zonedToUtc('2026-10-24', '15:00', 'Europe/London')).toBe('2026-10-24T14:00:00.000Z'); // BST
    expect(zonedToUtc('2026-10-31', '15:00', 'Europe/London')).toBe('2026-10-31T15:00:00.000Z'); // GMT
    expect(zonedToUtc('2026-08-15', '21:30', 'Europe/Madrid')).toBe('2026-08-15T19:30:00.000Z');
  });

  it('parses openfootball, keeps missing times as TBC, scores results', () => {
    const def = OPENFOOTBALL[0]!;
    const f = parseOpenfootball(
      {
        matches: [
          { round: 'Matchday 1', date: '2026-08-21', time: '20:00', team1: 'Arsenal FC', team2: 'Test Town FC', score: { ft: [3, 0], ht: [2, 0] } },
          { round: 'Matchday 30', date: '2027-04-10', team1: 'Chelsea FC', team2: 'Liverpool FC' },
        ],
      },
      def,
      Date.parse(NOW),
    );
    expect(f[0]).toMatchObject({ status: 'finished', score: { home: 3, away: 0 }, timeKnown: true, kickoffUtc: '2026-08-21T19:00:00.000Z' });
    expect(f[1]).toMatchObject({ status: 'scheduled', timeKnown: false });
    expect(f[1]!.kickoffUtc).toBeUndefined();
    expect(f[1]!.bigClubs).toEqual(['Chelsea FC', 'Liverpool FC']);
  });

  it('prioritises major competitions and big clubs (marquee bonus)', () => {
    expect(isBigClub('Manchester City FC')).toBe(true);
    expect(isBigClub('Test Town FC')).toBe(false);
    const marquee = fixturePriority('uefa-champions-league', 'Real Madrid', 'Bayern Munich');
    const smaller = fixturePriority('english-championship', 'Test Town', 'Other Town');
    expect(marquee).toBeGreaterThan(fixturePriority('english-premier-league', 'Arsenal', 'Test Town'));
    expect(smaller).toBeLessThan(fixturePriority('english-premier-league', 'Test Town', 'Other Town'));
  });

  it('recognises the same club under different providers names', () => {
    const same: [string, string][] = [
      ['US Lecce', 'Lecce'], ['FC Internazionale Milano', 'Inter Milan'], ['FC Bayern München', 'Bayern Munich'],
      ['Bayer 04 Leverkusen', 'Bayer Leverkusen'], ['1. FSV Mainz 05', 'Mainz'], ['Stade Rennais FC 1901', 'Rennes'],
      ['Stade Brestois 29', 'Brest'], ['Saint Johnstone FC', 'St Johnstone'], ['Kasımpaşa SK', 'Kasimpasa'],
      ['Çaykur Rizespor', 'Rizespor'], ['CA Mineiro', 'Atlético Mineiro'], ['Real Betis Balompié', 'Real Betis'],
      ['Club Atlético de Madrid', 'Atlético Madrid'], ['Heart of Midlothian', 'Hearts'], ['Sport Lisboa e Benfica', 'Benfica'],
      ['Paris Saint-Germain FC', 'Paris Saint-Germain'], ['Real Racing Club de Santander', 'Racing de Santander'],
    ];
    for (const [a, b] of same) expect([a, b, sameTeam(a, b)]).toEqual([a, b, true]);
    const different: [string, string][] = [
      ['AC Milan', 'Inter Milan'], ['Dundee', 'Dundee United'], ['Paris FC', 'Paris Saint-Germain'],
      ['RCD Espanyol de Barcelona', 'FC Barcelona'], ['Manchester City', 'Manchester United'], ['Real Madrid', 'Atlético Madrid'],
      ['Sporting Clube de Portugal', 'Sport Lisboa e Benfica'], ['Borussia Dortmund', 'Borussia Mönchengladbach'],
    ];
    for (const [a, b] of different) expect([a, b, sameTeam(a, b)]).toEqual([a, b, false]);
  });

  it('merges the same match from two providers', () => {
    const lg = TSDB_LEAGUES.filter((l) => l.competitionId === 'english-premier-league')[0]!;
    const t = fromTsdbEvent({ idEvent: '1', strHomeTeam: 'Arsenal', strAwayTeam: 'Test Town', strTimestamp: '2026-08-21T19:00:00' }, lg);
    const o = parseOpenfootball({ matches: [{ date: '2026-08-21', time: '20:00', team1: 'Arsenal FC', team2: 'Test Town FC' }] }, OPENFOOTBALL[0]!, Date.parse(NOW))[0]!;
    expect(sameMatch(o, t)).toBe(true);
    expect(t.kickoffUtc).toBe('2026-08-21T19:00:00.000Z');
  });

  it('maps TheSportsDB status codes and keeps unknown ones as the provider said', () => {
    const lg = TSDB_LEAGUES[0]!;
    const st = (strStatus: string, score = false) => fromTsdbEvent({ idEvent: '5', strHomeTeam: 'A', strAwayTeam: 'B', strStatus, intHomeScore: score ? '1' : null, intAwayScore: score ? '0' : null }, lg).status;
    expect([st('PST'), st('CANC'), st('ABD'), st('FT', true), st('NS'), st('Not Started'), st('1H')]).toEqual(['postponed', 'cancelled', 'abandoned', 'finished', 'scheduled', 'scheduled', 'provider: 1H']);
  });

  it('matches a rescheduled league match by round and teams, not by date alone', () => {
    const lg = TSDB_LEAGUES.filter((l) => l.competitionId === 'scottish-premiership')[0]!;
    const def = OPENFOOTBALL.filter((d) => d.id === 'scottish-premiership')[0]!;
    const t = fromTsdbEvent({ idEvent: '9', strHomeTeam: 'Rangers', strAwayTeam: 'Aberdeen', strTimestamp: '2026-10-31T15:00:00', intRound: '12' }, lg);
    const o = parseOpenfootball({ matches: [{ round: '1st Phase - 12', date: '2026-11-24', time: '20:00', team1: 'Rangers', team2: 'Aberdeen' }] }, def)[0]!;
    expect(sameMatch(o, t)).toBe(true);
    const other = parseOpenfootball({ matches: [{ round: '1st Phase - 30', date: '2027-03-06', time: '15:00', team1: 'Rangers', team2: 'Aberdeen' }] }, def)[0]!;
    expect(sameMatch(other, t)).toBe(false);
  });
});

describe('TheSportsDB round scans', () => {
  const lg = (id: string) => TSDB_LEAGUES.filter((l) => l.id === id)[0]!;
  it('requests a window of matchdays around now for European competitions', () => {
    expect(roundsToFetch(lg('4480').scan, 4, 3)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(roundsToFetch(lg('4328').scan, 9, 8)).toEqual([8, 9, 10]);
  });
  it('follows cup rounds numbered by teams remaining', () => {
    expect(roundsToFetch(lg('4483').scan, 128, 1)).toEqual([128, 64, 1]);
    expect(roundsToFetch(lg('4482').scan, 1, 4)).toEqual([1, 2, 4]);
    expect(roundLabel('32', lg('4485'))).toBe('Round of 32');
    expect(roundLabel('4', lg('4485'))).toBe('Semi-finals');
    expect(roundLabel('9', lg('4328'))).toBe('Matchday 9');
  });
  it('requests nothing when a season has no next event or no rounds', () => {
    expect(roundsToFetch(lg('4460').scan, 0, 200)).toEqual([]);
    expect(roundsToFetch(lg('4387').scan, 0, 0)).toEqual([]);
  });
});

describe('Football.TXT parser', () => {
  const MIDDLE = [
    '= Scotland | Premiership 2026/27',
    '# Matches  4',
    '',
    '▪ 1st Phase - 1',
    'Sat Dec 26 2026',
    '  15:00   Celtic  1-0 (0-0)  Rangers   ',
    "                  (Kasper Høgh 2', 90+5'(p);",
    "                   Oisin McEntee 35')",
    '          Hibernian  2-2 (1-1)  Aberdeen   ',
    'Sat Jan 2',
    '  12:30   Dundee   v   Motherwell   ',
    '',
    '▪ 1st Phase - 2 (date TBC)',
    '  Kilmarnock   v   Falkirk',
  ].join('\n');
  const AFTER = [
    '= Copa Libertadores 2026',
    '▪ Qualifying, Round 1',
    '  Tue Feb 10 2026',
    '    21:30  Deportivo Táchira FC (VEN) v Club The Strongest (BOL)  5-3 pen. (1-0, 1-0)',
    '           Chapecoense AF          v CR Vasco da Gama         [postponed]',
    '    19.00  Club Brugge             v KV Kortrijk 3-0',
    '▪ Finals, Final',
    '  Sat Nov 28',
    '           N.N.                    v N.N.',
  ].join('\n');

  it('reads both layouts, skips scorer blocks and rolls the year over', () => {
    const r = parseFootballTxt(MIDDLE);
    expect(r.warnings).toEqual([]);
    expect(r.matches.map((m) => [m.date, m.time, m.team1, m.team2, m.score && m.score.ft])).toEqual([
      ['2026-12-26', '15:00', 'Celtic', 'Rangers', [1, 0]],
      ['2026-12-26', '15:00', 'Hibernian', 'Aberdeen', [2, 2]],
      ['2027-01-02', '12:30', 'Dundee', 'Motherwell', undefined],
      [undefined, undefined, 'Kilmarnock', 'Falkirk', undefined],
    ]);
    const def = OPENFOOTBALL.filter((d) => d.id === 'scottish-premiership')[0]!;
    const fx = parseOpenfootball(r, def, Date.parse('2026-12-27T00:00:00Z'));
    expect(fx.map((f) => f.status)).toEqual(['finished', 'finished', 'scheduled', 'date-tbc']);
    expect(fx[2]!.kickoffUtc).toBe('2027-01-02T12:30:00.000Z');
    expect(fx[3]!.kickoffLocal).toBeUndefined();
  });

  it('keeps penalties, postponements and undecided finals as the source states them', () => {
    const r = parseFootballTxt(AFTER);
    expect(r.warnings).toEqual([]);
    const def = OPENFOOTBALL.filter((d) => d.id === 'copa-libertadores')[0]!;
    const fx = parseOpenfootball(r, def, Date.parse('2026-10-26T00:00:00Z'));
    expect(fx[0]!.score).toMatchObject({ home: 1, away: 0, htHome: 1, htAway: 0, penalties: { home: 5, away: 3 } });
    expect(fx[1]!.status).toBe('postponed');
    expect(fx[2]!.kickoffLocal!.time).toBe('19:00');
    expect(fx[2]!.score).toMatchObject({ home: 3, away: 0 });
    expect([fx[3]!.home, fx[3]!.away, fx[3]!.status]).toEqual(['To be decided', 'To be decided', 'scheduled']);
  });

  it('uses an explicit UTC offset when the time carries one (World Cup files)', () => {
    const def = OPENFOOTBALL.filter((d) => d.id === 'fifa-world-cup')[0]!;
    const fx = parseOpenfootball({ matches: [{ date: '2026-07-19', time: '15:00 UTC-4', team1: 'Spain', team2: 'Argentina', score: { et: [1, 0], ft: [0, 0], ht: [0, 0] } }] }, def);
    expect(fx[0]!.kickoffUtc).toBe('2026-07-19T19:00:00.000Z');
    expect(fx[0]!.score).toMatchObject({ home: 1, away: 0, afterExtraTime: true });
  });
});

describe('channels catalog', () => {
  it('groups alternative streams under one channel and keeps every source reference', () => {
    const recs = [
      classifyStream(entry('Same Channel HD', 'https://a.test/1.m3u8', { attrs: { 'tvg-country': 'GB' } }), ctx({ repo: 'free-tv', permission: 'free-only' }), null, NOW, 0),
      classifyStream(entry('Same Channel', 'https://b.test/1.m3u8', { attrs: { 'tvg-country': 'UK' } }), ctx({ repo: 'tvlist-awesome' }), null, NOW, 1),
      classifyStream(entry('Same Channel', 'https://b.test/1.m3u8', { attrs: { 'tvg-country': 'UK' } }), ctx({ repo: 'iptv-sources' }), null, NOW, 2),
    ];
    markDuplicates(recs);
    const ch = buildChannels(recs, {});
    expect(ch).toHaveLength(1);
    expect(ch[0]!.streams).toHaveLength(2);
    expect(ch[0]!.streams.flatMap((s) => s.sources.map((x) => x.repo)).sort()).toEqual(['free-tv', 'iptv-sources', 'tvlist-awesome']);
  });
});

describe('Xtream adapter (mock provider)', () => {
  const profile: XtreamProfile = { id: 'test', type: 'xtream', name: 'Test', server: 'https://provider.example.test', categoryLanguages: { 'EN |': 'eng', HINDI: 'hin' }, enabled: true };
  const creds = { username: 'tester', password: 's3cret!' };
  const fetcher: Fetcher = async (url) => {
    const a = /action=([a-z_]+)/.exec(url);
    const action = a ? a[1] : '';
    if (url.indexOf('xmltv.php') >= 0) return { status: 404, text: '' };
    if (action === 'get_account_info') return { status: 200, text: '{"user_info":{"auth":0}}' };
    if (action === '') return { status: 200, text: '{"user_info":{"auth":1,"status":"Active","exp_date":"1893456000","max_connections":"1"}}' };
    if (action === 'get_live_categories') return { status: 200, text: '[]' };
    if (action === 'get_vod_categories') return { status: 200, text: '[{"category_id":"1","category_name":"EN | Movies"},{"category_id":"2","category_name":"MISC"}]' };
    if (action === 'get_series_categories') return { status: 500, text: 'error' };
    if (action === 'get_vod_streams') return { status: 200, text: '[{"stream_id":10,"name":"Test Film","category_id":"1","container_extension":"mp4"},{"stream_id":11,"name":"Other","category_id":"2"}]' };
    return { status: 404, text: '' };
  };

  it('detects capabilities, trying several account actions', async () => {
    const c = await detectCapabilities(profile, creds, fetcher);
    expect(c).toMatchObject({ authenticated: true, live: true, vod: true, series: false, xmltv: false, maxConnections: 1 });
    expect(c.errors.join(' ')).not.toContain('s3cret');
  });

  it('imports VOD with language only from fields or your category map; no URLs stored', async () => {
    const vod = await importVod(profile, creds, fetcher);
    expect(vod.map((v) => [v.title, v.languages, v.languageSource])).toEqual([
      ['Test Film', ['eng'], 'user-category-map'],
      ['Other', [], 'none'],
    ]);
    expect(JSON.stringify(vod)).not.toContain('s3cret');
    expect(JSON.stringify(vod)).not.toContain('tester');
    expect(languageFor({ language: 'Bangla' }, undefined, undefined)).toEqual({ languages: ['ben'], languageSource: 'provider-field' });
  });

  it('builds play URLs only on demand and masks credentials in messages', () => {
    const u = playUrl(profile, creds, 'movie', '10', 'mp4');
    expect(u).toBe('https://provider.example.test/movie/tester/s3cret!/10.mp4');
    expect(maskSecrets(`failed ${u}`, creds)).toBe('failed https://provider.example.test/movie/***/***/10.mp4');
  });
});

describe('TV export selection rules', () => {
  it('maps registry items to filters instead of copying lists', () => {
    expect(selectFor({ id: 'country-uk' } as never)).toEqual({ country: 'uk' });
    expect(selectFor({ id: 'football-english' } as never)).toEqual({ football: 'any', language: 'eng' });
    expect(selectFor({ id: 'sport-cricket' } as never)).toEqual({ sport: 'cricket' });
  });

  it('maps provider profiles to their source, but not profile errors', () => {
    expect(selectFor({ id: 'profile-home' } as never)).toEqual({ source: 'profile:home' });
    expect(selectFor({ id: 'profile-error-home' } as never)).toBeNull();
    expect(selectFor({ id: 'profile-setup-xtream' } as never)).toBeNull();
  });

  it('TV-side filters give the same news/sports membership as the PC playlists (group names included)', () => {
    const recs = [
      classifyStream(entry('Grp Sport Only', 'https://a.test/1.m3u8', { group: 'Sports HD' }), ctx({ repo: 'free-tv' }), null, NOW, 0),
      classifyStream(entry('Grp News Only', 'https://a.test/2.m3u8', { group: '新闻频道' }), ctx({ repo: 'free-tv' }), null, NOW, 1),
      classifyStream(entry('Sky Cricket Plus', 'https://a.test/3.m3u8'), ctx({ repo: 'free-tv' }), null, NOW, 2),
      classifyStream(entry('Plain Channel', 'https://a.test/4.m3u8', { group: 'Entertainment' }), ctx({ repo: 'free-tv' }), null, NOW, 3),
    ];
    const chans = buildChannels(recs, {});
    const tv = chans.map((c) => adapt(compact(c)));
    const ids = (l: { id: string }[]) => l.map((c) => c.id).sort();
    expect(ids(applySelect(tv, { news: 'any' }))).toEqual(ids(chans.filter((c) => c.kind === 'stream' && isNews(c))));
    expect(ids(applySelect(tv, { sport: 'any' }))).toEqual(ids(chans.filter((c) => c.kind === 'stream' && isSports(c))));
    expect(ids(applySelect(tv, { sport: 'general' }))).toEqual(ids(chans.filter((c) => isSports(c) && !c.sports.length)));
    expect(applySelect(tv, { news: 'any' }).map((c) => c.name)).toEqual(['Grp News Only']);
    expect(applySelect(tv, { sport: 'any' }).map((c) => c.name).sort()).toEqual(['Grp Sport Only', 'Sky Cricket Plus']);
  });

  it('labels unavailable channels with the recorded reason and never claims an unchecked stream works', () => {
    const c = adapt({ i: 'x', n: 'X', p: 0, r: ['tvlist-awesome'], st: [{ u: '', s: 'restricted', v: 'untested' }] });
    expect(c.playable).toBe(false);
    expect(c.streams).toHaveLength(0);
    expect(libStatus(c)).toMatch(/Unavailable · link withheld/);
    const ok = adapt({ i: 'y', n: 'Y', p: 1, r: ['iptv-org'], st: [{ u: 'https://a.test/y.m3u8', s: 'imported', v: 'untested' }] });
    expect(libStatus(ok)).toBe('Untested');
  });
});

describe('Internet Archive public-domain items', () => {
  const films = ARCHIVE_SETS.filter((x) => x.id === 'films-eng')[0]!;
  const hindi = ARCHIVE_SETS.filter((x) => x.id === 'films-hin')[0]!;
  const ben = ARCHIVE_SETS.filter((x) => x.id === 'films-ben')[0]!;
  const PD = 'http://creativecommons.org/publicdomain/mark/1.0/';
  it('offers credible public-domain films and records why others are excluded', () => {
    expect(archiveEligible({ identifier: 'a', title: 'His Girl Friday', year: 1940, licenseurl: PD, collection: ['Comedy_Films', 'feature_films'] }, films).ok).toBe(true);
    expect(archiveEligible({ identifier: 'b', title: 'Rockstar ( 2011)', year: 2011, licenseurl: PD, collection: ['feature_films_unsorted'] }, hindi).reason).toMatch(/too recent/);
    expect(archiveEligible({ identifier: 'c', title: 'K. G. F Chapter 2 ( 2022) Bengali Dubbed 720p', licenseurl: PD, collection: ['opensource_movies'] }, ben).reason).toMatch(/rip/);
    expect(archiveEligible({ identifier: 'd', title: 'Pather Panchali BD. Rip 1080p X 264', licenseurl: PD, collection: ['opensource_movies'] }, ben).reason).toMatch(/rip/);
    expect(archiveEligible({ identifier: 'e', title: 'Some Upload', licenseurl: PD, collection: ['opensource_movies', 'community'] }, hindi).reason).toMatch(/undated/);
    expect(archiveEligible({ identifier: 'f', title: 'A Film', year: 1950, collection: ['feature_films'] }, films).reason).toMatch(/not marked/);
    expect(archiveEligible({ identifier: 'g', title: 'Les mille et une perversions', year: 1975, licenseurl: PD, collection: ['feature_films'] }, films).reason).toMatch(/adult/);
  });
  it('plays the H.264 derivative, one file per original, in episode order', () => {
    const files = playableFiles([
      { name: 'ep10.mp4', format: 'MPEG4', size: '900' },
      { name: 'ep10.ia.mp4', format: 'h.264 IA', size: '500', length: '1500.5' },
      { name: 'ep2.ia.mp4', format: 'h.264 IA', size: '400', length: '25:00' },
      { name: 'ep2_512kb.mp4', format: '512Kb MPEG4', size: '100' },
      { name: 'cover.jpg', format: 'JPEG' },
    ]);
    expect(files.map((f) => [f.name, f.length])).toEqual([
      ['ep2.ia.mp4', 1500],
      ['ep10.ia.mp4', 1501],
    ]);
  });
});
