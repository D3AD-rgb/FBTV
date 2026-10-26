/**
 * Classification rules shared by the inventory and catalogs. These never remove an entry:
 * they set categories, statuses and reasons that are recorded with it.
 */
import { fold } from '../shared/normalize.ts';
import { foldExtra, sameTeam } from '../shared/teams.ts';

// ------------------------------------------------------------------ sports taxonomy
export interface SportDef {
  id: string;
  name: string;
  /** Matched against folded channel names, group titles and alt names. */
  pattern: RegExp;
}

/** Order matters only for display; a channel can carry several sports. */
export const SPORTS: SportDef[] = [
  { id: 'football', name: 'Football', pattern: /\b(football|soccer|futbol|futebol|calcio|golazo|laliga|la liga|premier league|serie a|bundesliga|ligue 1|eredivisie|uefa|fifa)\b/ },
  { id: 'motorsport', name: 'Motorsport (F1, MotoGP, NASCAR, IndyCar)', pattern: /\b(f1|formula ?1|formula one|motogp|moto ?gp|nascar|indycar|indy car|motorsport|motor sport|racing|racer|speed|supercars|dtm|wec|le mans|motorvision)\b/ },
  { id: 'rally', name: 'Rally', pattern: /\b(rally|wrc|dakar|rallycross)\b/ },
  { id: 'basketball', name: 'Basketball (NBA)', pattern: /\b(nba|basketball|euroleague|wnba|baloncesto)\b/ },
  { id: 'cricket', name: 'Cricket', pattern: /\b(cricket|ipl|t20|willow|ptv sports|ten cricket)\b/ },
  { id: 'combat', name: 'UFC & MMA', pattern: /\b(ufc|mma|fight|fighting|combat|bellator|one championship|pfl|kickbox)\b/ },
  { id: 'boxing', name: 'Boxing', pattern: /\b(boxing|boxeo|box tv|dazn box)\b/ },
  { id: 'wrestling', name: 'Wrestling (WWE)', pattern: /\b(wwe|wrestling|aew|impact)\b/ },
  { id: 'tennis', name: 'Tennis', pattern: /\b(tennis|atp|wta|tenis)\b/ },
  { id: 'golf', name: 'Golf', pattern: /\b(golf|pga)\b/ },
  { id: 'rugby', name: 'Rugby', pattern: /\b(rugby|nrl|super rugby)\b/ },
  { id: 'american-football', name: 'American football (NFL)', pattern: /\b(nfl|american football|college football)\b/ },
  { id: 'baseball', name: 'Baseball (MLB)', pattern: /\b(mlb|baseball|beisbol)\b/ },
  { id: 'ice-hockey', name: 'Ice hockey (NHL)', pattern: /\b(nhl|hockey|khl|hockeytv)\b/ },
  { id: 'cycling', name: 'Cycling', pattern: /\b(cycling|ciclismo|tour de france|velo)\b/ },
  { id: 'cue-darts', name: 'Snooker, pool & darts', pattern: /\b(snooker|billiard|billiards|pool|darts|kozoom)\b/ },
  { id: 'horse-racing', name: 'Horse racing', pattern: /\b(horse|equestrian|turf|racing tv|sky racing|tvg|hipica)\b/ },
  { id: 'olympic', name: 'Olympics & athletics', pattern: /\b(olympic|olympics|athletics|paralymp)\b/ },
  { id: 'esports', name: 'Esports & gaming', pattern: /\b(esports|e sports|cybersport|gaming|maincast)\b/ },
  { id: 'winter', name: 'Winter sports', pattern: /\b(ski|skiing|snowboard|winter sport|biathlon)\b/ },
  { id: 'outdoor', name: 'Outdoor, fishing & extreme', pattern: /\b(fishing|hunting|outdoor|extreme|surf|red bull tv|fuel tv|waypoint)\b/ },
];

export function sportsOf(...texts: (string | undefined)[]): string[] {
  const hay = fold(texts.filter(Boolean).join(' '));
  const out: string[] = [];
  for (const s of SPORTS) if (s.pattern.test(hay)) out.push(s.id);
  return out;
}

// ------------------------------------------------------------------ football roles
/**
 * Brands that hold football rights in at least one market (rights vary by country and
 * season). Being listed here never implies that a channel shows a particular match.
 */
export const FOOTBALL_BROADCASTER =
  /\b(bein|sky sports?|tnt sports|bt sport|dazn|espn|eleven|supersport|premier sports|setanta|arena sport|sport ?tv|sportitalia|rmc sport|canal\+ ?(sport|foot)|movistar|digi ?sport|nova sport|polsat sport|sport ?klub|match!?|alkass|al kass|ad sports|abu dhabi sports|dubai sports|ssc|ksa sports|on time sports|on sport|oman sports|bahrain sports|sharjah sports|kuwait sport|iraq sport|qatar sport|cbs sports|fox sports|tudn|univision deportes|tyc sports|win sports|gol ?tv|goltv|claro sports|star sports|sony sports|ten sports|ptv sports|t sports|gtv sports|a sports|sportdigital|servus|ziggo sport|viaplay|tv2 sport|v sport|cosmote sport|nova sports|ert sport|trt spor|bein spor|s sport|a spor|tivibu|sport 1|sport1|sportv|premiere|band sports|espn brasil|sport24|kanal sport)\b/i;

/** Club TV: a club name AND a TV/channel word (so "Roma TV", a Rome station, is not enough on its own). */
export const CLUB_TV =
  /\b(real madrid|barça|barca|fc barcelona|atl[eé]tico|chelsea|mutv|lfc|liverpool|arsenal|man(chester)? (city|utd|united)|tottenham|spurs|benfica|sporting|porto|juventus|inter|milan|lazio|roma|napoli|bayern|bvb|borussia|psg|olympique|galatasaray|fenerbah[cç]e|be[sş]ikta[sş]|ajax|psv|feyenoord|celtic|rangers|dynamo|zenit|spartak|cska|al ahly|zamalek|al hilal|al nassr|boca|river plate|flamengo|corinthians|palmeiras|gr[eê]mio|santos|pe[nñ]arol|club am[eé]rica|chivas)\b.*\b(tv|channel|canal|style|play)\b|\bcanal do (inter|gr[eê]mio)\b/i;

export const FOOTBALL_DEDICATED = /\b(football|soccer|futbol|fútbol|futebol|calcio|golazo|fifa\+|laliga|la liga tv|premier league tv|serie a tv|bundesliga tv|ligue 1|eredivisie|liga portugal|mls|goal ?tv|footballtv|كرة القدم|足球)\b/i;

export type FootballRole = 'dedicated' | 'club' | 'broadcaster-brand';

const NON_SPORT = ['music', 'news', 'religious', 'kids', 'shop', 'weather', 'cooking', 'travel'];

/**
 * Football role of a channel. `sportsCategory` = the source files it under sports.
 * Club names only count for sports channels; generic football words count unless the source
 * files the channel as non-sport (e.g. "Soccer Anthems" is a music channel).
 */
export function footballRole(name: string, groups: string[], categories: string[], sportsCategory: boolean): FootballRole | null {
  const nonSport = categories.some((c) => NON_SPORT.indexOf(c) >= 0);
  if (FOOTBALL_DEDICATED.test(name) && !nonSport) return 'dedicated';
  if (groups.some((g) => FOOTBALL_DEDICATED.test(g)) && !nonSport) return 'dedicated';
  if (sportsCategory && CLUB_TV.test(name)) return 'club';
  if ((sportsCategory || groups.some((g) => /\bsport/i.test(g))) && FOOTBALL_BROADCASTER.test(name)) return 'broadcaster-brand';
  return null;
}

// ------------------------------------------------------------------ restricted relays
/**
 * Pay-TV channel brands. In relay sources (third-party re-streams of operator or pay
 * channels) an entry matching these has its URL withheld: it is recorded, with the reason,
 * but FBTV will not play it. In curated public sources (iptv-org, Free-TV) the same brands
 * are kept and flagged, because those projects only list streams they believe are public.
 */
export const PAY_TV_RELAY =
  /(\bhbo\b|cinemax|\baxn\b|star ?(movies|world|sports|plus|gold|chinese)|\bfox\b|disney|discovery|nat ?geo|national geographic|history|animal planet|bbc (earth|lifestyle|first)|\bbein\b|eleven sports|\bespn\b|sky ?(sports|cinema|atlantic|one)|\btvb\b|翡翠|明珠台|凤凰|鳳凰|付费|风云足球|風雲足球|世界地理|文化精品|怀旧剧场|第一剧场|风云剧场|风云音乐|兵器科技|女性时尚|高尔夫|电视指南|newtv|ihot|sitv|cibn|爱奇艺|华数|\bchc\b|美亚|龙华|龍華|纬来|緯來|东森|東森|三立|八大|中天|年代|卫视电影|衛視電影|卫视中文|天映|celestial|澳亚|mastv)/i;

// ------------------------------------------------------------------ fixtures priority
export const BIG_CLUBS = [
  'real madrid', 'barcelona', 'atletico madrid', 'manchester city', 'manchester united', 'liverpool', 'arsenal', 'chelsea',
  'tottenham', 'newcastle', 'aston villa', 'bayern munich', 'bayern munchen', 'borussia dortmund', 'bayer leverkusen', 'rb leipzig',
  'paris saint germain', 'psg', 'marseille', 'lyon', 'monaco', 'juventus', 'inter', 'internazionale', 'milan', 'ac milan', 'napoli',
  'roma', 'lazio', 'atalanta', 'benfica', 'porto', 'sporting', 'ajax', 'psv', 'feyenoord', 'celtic', 'rangers', 'galatasaray',
  'fenerbahce', 'besiktas', 'sevilla', 'villarreal', 'real sociedad', 'athletic', 'betis',
];

/** Competition importance (higher first). Keys are normalised competition ids used in fixtures.ts. */
export const COMPETITION_TIER: Record<string, number> = {
  'uefa-champions-league': 100,
  'fifa-world-cup': 100,
  'english-premier-league': 96,
  'uefa-euro': 95,
  'spanish-la-liga': 90,
  'uefa-europa-league': 85,
  'italian-serie-a': 85,
  'german-bundesliga': 85,
  'french-ligue-1': 78,
  'fa-cup': 74,
  'copa-del-rey': 68,
  'efl-cup': 66,
  'uefa-conference-league': 64,
  'uefa-nations-league': 62,
  'dfb-pokal': 60,
  'coppa-italia': 60,
  'coupe-de-france': 56,
  'english-championship': 55,
  'dutch-eredivisie': 55,
  'portuguese-primeira-liga': 55,
  'scottish-premiership': 50,
  'turkish-super-lig': 48,
  'saudi-pro-league': 46,
  'american-mls': 44,
  'brazilian-serie-a': 44,
  'argentine-primera': 42,
  'copa-libertadores': 52,
  'belgian-pro-league': 45,
  'austrian-bundesliga': 40,
  'swiss-super-league': 40,
  'greek-super-league': 40,
};

export function normTeam(name: string): string {
  return fold(foldExtra(name))
    .replace(/\b(fc|afc|cf|sc|ac|ss|ssc|as|rc|cd|ud|sd|sv|vfl|vfb|tsg|1|fk|sk|bk|club|calcio|de|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isBigClub(team: string): boolean {
  return BIG_CLUBS.some((b) => sameTeam(b, team));
}

/** Priority for ordering fixtures: competition tier + big clubs (both big = marquee). Pure. */
export function fixturePriority(competition: string, home: string, away: string): number {
  const tier = COMPETITION_TIER[competition] || 35;
  const h = isBigClub(home);
  const a = isBigClub(away);
  return tier + (h ? 15 : 0) + (a ? 15 : 0) + (h && a ? 10 : 0);
}

// ------------------------------------------------------------------ stream legitimacy (Clearstream rules)
// Adopted from Clearstream (github.com/killerwaz/clearstream, MIT): a free player that keeps only
// verifiable free sports channels. Lists copied as of 2026-10-22; credited in THIRD_PARTY.md.

/** Hosts Clearstream identifies as restreamers or third-party relays. */
export const RESTREAM_HOSTS = [
  'jmp2.uk', 'mjh.nz', 'githubusercontent.com', 'github.io', 'onrender.com', 'herokuapp.com', 'workers.dev', 'pages.dev',
  'glitch.me', 'dpdns.org', 'ngrok.io', 'aynascope.net', 'aynaott.com', 'bozztv.com', 'stmify.com', 'rezofoot.tv',
  'mcquack.net', 'iptvperu.tv', 'boldmss.com', 'nellaiiptv.com', 'cc.cd', 'playstop.me', 'siauliairsavlt.pw',
  'rabta.stream', 'thelegitpro.in', 'livelegitpro.in', 'jswk.online', 'gpcdn.net',
];

/** Video platforms that official free (FAST) channels and broadcasters stream from. */
export const OFFICIAL_PLATFORM_HOSTS = [
  'amagi.tv', 'wurl.com', 'wurl.tv', 'tubi.video', 'tubi.io', 'cbsivideo.com', 'dai.google.com', 'nbcuni.com',
  'brightcove.com', 'akamaized.net', 'akamaihd.net', 'cloudfront.net', 'mangomolo.com', 'mgmlcdn.com',
  'frequency.stream', 'getpublica.com', 'klowdtv.com', 'sofast.tv', 'amazonaws.com', 'zype.com', 'transmit.live',
  'uplynk.com', 'streamlock.net', 'wowza.com', 'cdn77.org', 'vgcdn.net', 'itworkscdn.net', 'streamhoster.com',
];

/** Pay-TV sports brands, which are never legitimately free (free variants such as beIN SPORTS XTRA excepted). */
export const PAY_SPORTS = new RegExp(
  [
    '\\bsky sports\\b', '\\bbein sports(?! xtra)\\b', 'star sports', 'sony (sports|ten|six)', '\\bten (sports|cricket)\\b',
    '\\bespn(?!8)', 'fox sports [12]\\b', '\\bfs1\\b', 'nfl network', 'nba tv', '\\bmsg\\b', 'usa network', 'wwe network',
    'setanta', 'dsports', 'tnt sports', '\\bbt sport', 'eurosport', '\\bdazn(?! combat)', '^willow( hd)?$', '\\bmutv\\b',
    'supersport', 'sportsnet', '\\btsn\\b', 'fox deportes', 'golf channel', 'premier sports', 'viaplay', 'unite8',
    '^m sports$', 'one golf', '^pk sports$', '^t sports$', 'ptv sports', 'ad sports', 'abu dhabi sports', '\\bssc\\b',
    'kayo', 'optus sport',
  ].join('|'),
  'i',
);

/** More pay sports brands (FBTV additions to Clearstream's list). */
export const PAY_SPORTS_MORE = new RegExp(
  ['\\btudn\\b', '\\bfox sports\\b', 'eleven sports', 'arena sport', 'canal\\+ ?sport', 'movistar', 'polsat sport', 'nova sport',
    'digi sport', 'cosmote sport', 'sportdigital', '\\bsport ?tv ?\\d', 'claro sports', 'win sports\\+', 'ziggo sport', 'tv2 sport', 'v sport'].join('|'),
  'i',
);

/** Free versions of pay brands, which stay playable. */
export const FREE_SPORTS_VARIANT = /bein sports xtra|espn8|dazn combat|golazo|fifa\+|red bull|stadium|tennis channel/i;

/** A paid sports channel: never legitimately free. Pure. */
export function isPaySports(name: string, sportsChannel: boolean): boolean {
  if (FREE_SPORTS_VARIANT.test(name)) return false;
  return PAY_SPORTS.test(name) || PAY_SPORTS_MORE.test(name) || (sportsChannel && PAY_TV_RELAY.test(name));
}

export function hostIn(host: string, list: string[]): boolean {
  const h = host.toLowerCase();
  return list.some((s) => h === s || h.endsWith('.' + s));
}

/** 'official' when served over https from an official platform, 'restream' on a known restream host. Pure. */
export function streamPlatform(url: string, host: string): 'official' | 'restream' | undefined {
  if (!host) return undefined;
  if (hostIn(host, RESTREAM_HOSTS)) return 'restream';
  const ip = /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.charAt(0) === '[';
  if (/^https:/i.test(url) && !ip && hostIn(host, OFFICIAL_PLATFORM_HOSTS)) return 'official';
  return undefined;
}

/** National channels that carry cricket or football without saying so in their name. */
export const EXTRA_SPORTS: Record<string, string[]> = {
  'DDSports.in': ['cricket'],
  'PTVSports.pk': ['cricket'],
  'TSports.bd': ['cricket', 'football'],
};

export { sameTeam, teamTokens } from '../shared/teams.ts';
