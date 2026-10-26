/**
 * Every source the library reads: the nine supplied repositories, the upstreams they
 * reference, and fixture/data APIs. Nothing is silently skipped:
 *
 *  - handling 'copy':      the original file is preserved byte-for-byte in repositories/<repo>/
 *  - handling 'reference': the file is parsed in place (Git snapshot or a fetch that is not
 *                          stored); its entries are inventoried, but the original is not kept
 *  - policy 'keep':          every entry keeps its URL
 *  - policy 'withhold-pay':  entries naming pay-TV channels keep everything except the URL
 *  - policy 'withhold-all':  every entry is recorded without its URL (hotel leaks, piracy,
 *                            access-control bypass)
 *
 * Permission classes: open (explicit open licence), free-only (free-to-air policy, no
 * licence file), unclear (no licence / mixed provenance), user (your own profiles).
 */
export type Permission = 'open' | 'free-only' | 'unclear' | 'user';
export type Handling = 'copy' | 'reference';
export type EntryPolicy = 'keep' | 'withhold-pay' | 'withhold-all';
export type Category =
  | 'live-tv'
  | 'radio'
  | 'epg'
  | 'docs'
  | 'metadata'
  | 'fixtures'
  | 'test-fixture'
  | 'resource-list'
  | 'app-channel-list'
  | 'template';

export interface FileRule {
  match: RegExp;
  handling: Handling;
  policy: EntryPolicy;
  permission: Permission;
  category: Category;
  reason?: string;
}

export interface RemoteFile {
  path: string;
  url: string;
  handling: Handling;
  policy: EntryPolicy;
  permission: Permission;
  category: Category;
  reason?: string;
  note?: string;
}

export interface RepoDef {
  id: string;
  name: string;
  url: string;
  licence: string;
  summary: string;
  /** Repository-relative rules, first match wins. Unmatched files are recorded as "not relevant (code/assets)". */
  rules: FileRule[];
  remote?: RemoteFile[];
  /** References recorded for the audit only (nothing to fetch, or fetching is not appropriate). */
  references?: { url: string; reason: string }[];
}

const DOCS: FileRule = { match: /^(README[^/]*|LICENSE[^/]*|PLAYLISTS\.md|NOTES\.md)$/i, handling: 'copy', policy: 'keep', permission: 'open', category: 'docs' };
const IO = 'https://iptv-org.github.io';
const RAW = 'https://raw.githubusercontent.com';

const IPTV_ORG_PUBLISHED: RemoteFile[] = [
  { path: 'published/index.m3u', url: `${IO}/iptv/index.m3u`, handling: 'copy', policy: 'keep', permission: 'open', category: 'live-tv' },
  ...[
    'animation', 'auto', 'business', 'classic', 'comedy', 'cooking', 'culture', 'documentary', 'education', 'entertainment', 'family',
    'general', 'interactive', 'kids', 'legislative', 'lifestyle', 'movies', 'music', 'news', 'outdoor', 'public', 'relax', 'religious',
    'science', 'series', 'shop', 'sports', 'travel', 'weather', 'undefined',
  ].map((c): RemoteFile => ({ path: `published/categories/${c}.m3u`, url: `${IO}/iptv/categories/${c}.m3u`, handling: 'copy', policy: 'keep', permission: 'open', category: 'live-tv' })),
  ...['eng', 'ara', 'ben', 'hin', 'urd', 'spa', 'fra', 'por', 'deu', 'ita', 'tur', 'rus', 'zho', 'fas', 'tam', 'tel', 'mal', 'pan'].map(
    (l): RemoteFile => ({ path: `published/languages/${l}.m3u`, url: `${IO}/iptv/languages/${l}.m3u`, handling: 'copy', policy: 'keep', permission: 'open', category: 'live-tv' }),
  ),
  ...['channels', 'feeds', 'streams', 'logos', 'countries', 'languages', 'categories', 'blocklist', 'regions', 'subdivisions', 'timezones', 'guides'].map(
    (f): RemoteFile => ({ path: `api/${f}.json`, url: `${IO}/api/${f}.json`, handling: 'copy', policy: 'keep', permission: 'open', category: 'metadata' }),
  ),
];

export const REPOS: RepoDef[] = [
  {
    id: 'iptv-org',
    name: 'iptv-org/iptv',
    url: 'https://github.com/iptv-org/iptv',
    licence: 'Unlicense (public domain)',
    summary: 'Community-maintained links to publicly available live TV streams, one source file per country/provider; DMCA removals go to a blocklist. Live only, no VOD.',
    rules: [
      DOCS,
      { match: /^streams\/[^/]+\.m3u$/i, handling: 'copy', policy: 'keep', permission: 'open', category: 'live-tv' },
      { match: /^tests\/.*\.m3u8?$/i, handling: 'copy', policy: 'keep', permission: 'open', category: 'test-fixture', reason: 'Repository test fixture (synthetic data)' },
    ],
    remote: IPTV_ORG_PUBLISHED,
  },
  {
    id: 'my-tv',
    name: 'lizongying/my-tv',
    url: 'https://github.com/lizongying/my-tv',
    licence: 'None (README: study only, no commercial use)',
    summary: 'Android TV app with a hard-coded list of 67 CCTV/provincial channels; streams come from a broadcaster API whose signed tokens the app reproduces through a closed native library.',
    rules: [
      { match: /^README[^/]*\.md$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'docs' },
      {
        match: /^app\/src\/main\/java\/com\/lizongying\/mytv\/TVList\.kt$/,
        handling: 'reference',
        policy: 'withhold-all',
        permission: 'unclear',
        category: 'app-channel-list',
        reason: 'Streams require reproducing the broadcaster’s signed-token access control',
      },
    ],
  },
  {
    id: 'tvlist-awesome',
    name: 'imDazui/Tvlist-awesome-m3u-m3u8',
    url: 'https://github.com/imDazui/Tvlist-awesome-m3u-m3u8',
    licence: 'None stated',
    summary: 'Hand-collected M3U files: China ISP multicast/unicast lists, pay-TV relays, general Chinese and foreign lists, radio.',
    rules: [
      { match: /^README[^/]*\.md$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'docs' },
      {
        match: /^m3u\/.*(付费|轮播|NewTV|CIBN|爱奇艺|华数|黑莓|影视剧场).*\.m3u8?$/i,
        handling: 'reference',
        policy: 'withhold-all',
        permission: 'unclear',
        category: 'live-tv',
        reason: 'Pay-TV / premium-package relay list (CCTV pay channels, NewTV/iQiyi/CIBN carousels)',
      },
      {
        match: /^m3u\/.*(台湾|香港|海外).*\.m3u8?$/i,
        handling: 'reference',
        policy: 'withhold-pay',
        permission: 'unclear',
        category: 'live-tv',
        reason: 'Mixed list: free HK/TW channels kept; pay-TV relays (HBO, TVB overseas, Star…) withheld',
      },
      { match: /^m3u\/.*广播电台.*\.m3u8?$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'radio' },
      { match: /^m3u\/.*\.m3u8?$/i, handling: 'copy', policy: 'withhold-pay', permission: 'unclear', category: 'live-tv' },
    ],
  },
  {
    id: 'fanmingming-live',
    name: 'fanmingming/live',
    url: 'https://github.com/fanmingming/live',
    licence: 'GPL-3.0',
    summary: 'TV logo set (~1,400 images), a China-only XMLTV guide refreshed every 2 hours, and playlists that are IPv6-only or China Mobile-internal.',
    rules: [
      DOCS,
      {
        match: /^tv\/m3u\/itv\.m3u$/i,
        handling: 'reference',
        policy: 'withhold-pay',
        permission: 'unclear',
        category: 'live-tv',
        reason: 'China Mobile ITV-internal list that includes paid NewTV/iHOT packages (those withheld)',
      },
      { match: /^tv\/m3u\/.*\.m3u$/i, handling: 'copy', policy: 'withhold-pay', permission: 'unclear', category: 'live-tv' },
      { match: /^radio\/m3u\/.*\.m3u$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'radio' },
      { match: /^assets\/.*\.m3u8$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'test-fixture', reason: 'Placeholder "no signal" stream used by the repository' },
      { match: /^e\.xml$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'epg' },
    ],
  },
  {
    id: 'iptv-api',
    name: 'Guovin/iptv-api',
    url: 'https://github.com/Guovin/iptv-api',
    licence: 'AGPL-3.0',
    summary: 'Python tool that gathers and speed-tests streams; the repository ships templates and filters but no stream URLs. Its published output is China/HK/TW only and re-streams pay channels via relays.',
    rules: [
      DOCS,
      { match: /^config\/(demo|alias|whitelist|blacklist|local|subscribe)\.txt$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'template' },
      { match: /^config\/epg\.txt$/i, handling: 'copy', policy: 'keep', permission: 'unclear', category: 'metadata' },
    ],
    remote: [
      {
        path: 'published/result.m3u',
        url: 'https://guovin.github.io/iptv-api/result.m3u',
        handling: 'reference',
        policy: 'withhold-pay',
        permission: 'unclear',
        category: 'live-tv',
        reason: 'Published output re-streams pay channels (CCTV pay, CHC, TVB) through relays; those withheld, others kept',
      },
    ],
  },
  {
    id: 'zhuiju-free',
    name: 'laoma528/awesome-zhuiju-free',
    url: 'https://github.com/laoma528/awesome-zhuiju-free',
    licence: 'CC BY 4.0 (list text only)',
    summary: 'Machine-readable list of 126 drama/VOD websites, TVBox configs, magnet search, players and projects, each with the repository’s own copyright-risk rating. No streams.',
    rules: [
      { match: /^LICENSE[^/]*$/i, handling: 'copy', policy: 'keep', permission: 'open', category: 'docs' },
      { match: /^resources\/resources\.json$/, handling: 'reference', policy: 'withhold-pay', permission: 'unclear', category: 'resource-list', reason: 'High-copyright-risk sites (by the repository’s own rating) recorded without URLs' },
    ],
  },
  {
    id: 'awesome-iptv',
    name: 'iptv-org/awesome-iptv',
    url: 'https://github.com/iptv-org/awesome-iptv',
    licence: 'CC0',
    summary: 'Index of IPTV resources; the list itself moved to GitHub Discussions (outside the repository files). Led to Free-TV/IPTV.',
    rules: [DOCS],
    references: [{ url: 'https://github.com/iptv-org/awesome-iptv/discussions', reason: 'Resource lists live in GitHub Discussions, not in repository files' }],
  },
  {
    id: 'iptv-sources',
    name: 'HerbertHe/iptv-sources',
    url: 'https://github.com/HerbertHe/iptv-sources',
    licence: 'GPL-3.0',
    summary: 'Aggregator (code idle since Feb 2025) that re-publishes eight upstream lists every 2 hours at m3u.ibert.me.',
    rules: [DOCS],
    remote: [
      ...[
        ['upstreams/epg.pw/test_channels_all.m3u', 'https://epg.pw/test_channels_all.m3u'],
        ['upstreams/epg.pw/test_channels_china.m3u', 'https://epg.pw/test_channels_china.m3u'],
        ['upstreams/YueChan/IPTV.m3u', `${RAW}/YueChan/Live/main/IPTV.m3u`],
        ['upstreams/YanG-1989/Gather.m3u', `${RAW}/YanG-1989/m3u/main/Gather.m3u`],
        ['upstreams/joevess/iptv.m3u8', `${RAW}/joevess/IPTV/main/iptv.m3u8`],
        ['upstreams/joevess/home.m3u8', `${RAW}/joevess/IPTV/main/home.m3u8`],
        ['upstreams/qwerttvv/IPTV-Mobile.m3u', `${RAW}/qwerttvv/Beijing-IPTV/master/IPTV-Mobile.m3u`],
        ['upstreams/qwerttvv/IPTV-Mobile-Multicast.m3u', `${RAW}/qwerttvv/Beijing-IPTV/master/IPTV-Mobile-Multicast.m3u`],
        ['upstreams/qwerttvv/IPTV-Unicom.m3u', `${RAW}/qwerttvv/Beijing-IPTV/master/IPTV-Unicom.m3u`],
        ['upstreams/qwerttvv/IPTV-Unicom-Multicast.m3u', `${RAW}/qwerttvv/Beijing-IPTV/master/IPTV-Unicom-Multicast.m3u`],
        ['published/o_all.m3u', 'https://m3u.ibert.me/o_all.m3u'],
        ['published/all.m3u', 'https://m3u.ibert.me/all.m3u'],
        ['published/cn.m3u', 'https://m3u.ibert.me/cn.m3u'],
        ['published/txt/merged.txt', 'https://m3u.ibert.me/txt/merged.txt'],
      ].map(
        ([path, url]): RemoteFile => ({ path: path!, url: url!, handling: 'copy', policy: 'withhold-pay', permission: 'unclear', category: 'live-tv' }),
      ),
      {
        path: 'upstreams/cymz6/lives.m3u',
        url: `${RAW}/cymz6/AutoIPTV-Hotel/main/lives.m3u`,
        handling: 'reference',
        policy: 'withhold-all',
        permission: 'unclear',
        category: 'live-tv',
        reason: 'Leaked hotel IPTV gateways (using them is unauthorised access to those systems)',
      },
    ],
    references: [
      { url: `${RAW}/iptv-org/iptv/gh-pages/index.m3u`, reason: 'Upstream duplicate of iptv-org (imported from iptv-org directly)' },
      { url: `${RAW}/fanmingming/live/main/tv/m3u/index.m3u`, reason: 'Upstream duplicate of fanmingming (imported directly)' },
    ],
  },
  {
    id: 'iptvnator',
    name: '4gray/iptvnator',
    url: 'https://github.com/4gray/iptvnator',
    licence: 'MIT (name trademarked)',
    summary: 'IPTV player (Electron/Angular, experimental webOS app). No playlists; adapters for M3U, Xtream Codes and Stalker accounts supplied by the user.',
    rules: [DOCS, { match: /^apps\/web-e2e\/src\/fixtures\/.*\.m3u8?$/i, handling: 'copy', policy: 'keep', permission: 'open', category: 'test-fixture', reason: 'End-to-end test fixture' }],
  },
];

/** Sources found by following references, and fixture / data APIs. */
export const DISCOVERED: RepoDef[] = [
  {
    id: 'free-tv',
    name: 'Free-TV/IPTV (via iptv-org/awesome-iptv)',
    url: 'https://github.com/Free-TV/IPTV',
    licence: 'None stated; free-to-air-only inclusion policy',
    summary: 'Curated free channels by country (pay-TV excluded by policy; geo-blocked channels marked Ⓖ).',
    rules: [],
    remote: [
      { path: 'playlist.m3u8', url: `${RAW}/Free-TV/IPTV/master/playlist.m3u8`, handling: 'copy', policy: 'keep', permission: 'free-only', category: 'live-tv' },
      { path: 'README.md', url: `${RAW}/Free-TV/IPTV/master/README.md`, handling: 'copy', policy: 'keep', permission: 'free-only', category: 'docs' },
    ],
  },
  {
    id: 'openfootball',
    name: 'openfootball (football.json, worldcup.json, europe, belgium, austria, south-america — fixtures, not streams)',
    url: 'https://github.com/openfootball/football.json',
    licence: 'Public domain',
    summary: 'Full-season fixtures and results for 15 leagues (2026-27 / 2026), Copa Libertadores 2026 and the 2026 World Cup. Match data only — never a broadcast source.',
    rules: [],
    remote: [
      ...['en.1', 'en.2', 'es.1', 'it.1', 'de.1', 'fr.1', 'nl.1', 'pt.1'].map(
        (code): RemoteFile => ({ path: `2026-27/${code}.json`, url: `${RAW}/openfootball/football.json/master/2026-27/${code}.json`, handling: 'copy', policy: 'keep', permission: 'open', category: 'fixtures' }),
      ),
      { path: 'worldcup/2026/worldcup.json', url: `${RAW}/openfootball/worldcup.json/master/2026/worldcup.json`, handling: 'copy', policy: 'keep', permission: 'open', category: 'fixtures' },
      // Football.TXT seasons from other openfootball repositories (same public-domain dedication).
      ...[
        ['scotland/2026-27_sco1.txt', 'europe/master/scotland/2026-27_sco1.txt'],
        ['turkey/2026-27_tr1.txt', 'europe/master/turkey/2026-27_tr1.txt'],
        ['greece/2026-27_gr1.txt', 'europe/master/greece/2026-27_gr1.txt'],
        ['switzerland/2026-27_ch1.txt', 'europe/master/switzerland/2026-27_ch1.txt'],
        ['belgium/2026-27_be1.txt', 'belgium/master/2026-27/be1.txt'],
        ['austria/2026-27_1-bundesliga.txt', 'austria/master/2026-27/1-bundesliga.txt'],
        ['brazil/2026_br1.txt', 'south-america/master/brazil/2026_br1.txt'],
        ['copa-libertadores/2026_copal.txt', 'south-america/master/copa-libertadores/2026_copal.txt'],
      ].map(([path, src]): RemoteFile => ({ path: `txt/${path}`, url: `${RAW}/openfootball/${src}`, handling: 'copy', policy: 'keep', permission: 'open', category: 'fixtures' })),
    ],
  },
];
