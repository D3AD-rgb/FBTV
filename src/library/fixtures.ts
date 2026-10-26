/**
 * Fixtures and events — schedule data only, never a broadcast source.
 *
 *  - openfootball (public domain): full seasons for 15 leagues, Copa Libertadores and the
 *    2026 World Cup (JSON and Football.TXT); local kick-off times are converted to UTC with the
 *    league's time zone (DST-aware). Missing times stay "TBC", missing dates "Date TBC".
 *  - TheSportsDB (documented free key "123"): on this key next/past return one event each and
 *    a season only its first 15, so whole rounds around now are requested (`eventsround`),
 *    cup rounds by teams remaining, and days ahead for leagues without rounds (3 events/day),
 *    plus TV listings for the highest-priority upcoming matches. Every competition id is
 *    verified against the name the API returns; an unanswered lookup is retried, never
 *    treated as a mismatch.
 *
 * Every API response is kept as an original under repositories/thesportsdb/.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COMPETITION_TIER, fixturePriority, isBigClub, sameTeam } from './policy.ts';
import { USER_AGENT } from '../builder/fetch.ts';

export interface Broadcast {
  country?: string;
  channel: string;
  source: 'thesportsdb';
}

export interface Fixture {
  id: string;
  sport: string;
  competitionId: string;
  competition: string;
  season?: string;
  round?: string;
  kickoffUtc?: string;
  kickoffLocal?: { date: string; time?: string; timeZone: string };
  timeKnown: boolean;
  home: string;
  away: string;
  homeBadge?: string;
  awayBadge?: string;
  event?: string;
  status: string;
  score?: { home: number; away: number; htHome?: number; htAway?: number; afterExtraTime?: boolean; penalties?: { home: number; away: number } };
  /** Source marker such as postponed or awarded. */
  note?: string;
  priority: number;
  bigClubs: string[];
  sources: { provider: 'openfootball' | 'thesportsdb'; ref: string }[];
  broadcasts: Broadcast[];
}

export interface CompetitionInfo {
  id: string;
  name: string;
  sport: string;
  country?: string;
  tier: number;
  providers: string[];
  fixtures: number;
  verified: boolean;
  error?: string;
  note?: string;
}

// ------------------------------------------------------------------ time zones
/** Converts a local wall-clock date/time in `timeZone` to UTC (handles DST). Pure. */
export function zonedToUtc(date: string, time: string, timeZone: string): string {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = time.split(':').map(Number) as [number, number];
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date(guess));
    const get = (t: string) => Number(parts.filter((p) => p.type === t)[0]!.value);
    const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    const want = Date.UTC(y, mo - 1, d, h, mi);
    const diff = want - asUtc;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess).toISOString();
}

// ------------------------------------------------------------------ openfootball
export interface OpenfootballDef {
  /** Path under repositories/openfootball/. */
  file: string;
  id: string;
  name: string;
  country: string;
  /** Time zone of the kick-off times in the file (used unless a time carries its own UTC offset). */
  tz: string;
  season?: string;
  format?: 'json' | 'txt';
  note?: string;
}

export const OPENFOOTBALL: OpenfootballDef[] = [
  { file: '2026-27/en.1.json', id: 'english-premier-league', name: 'Premier League', country: 'England', tz: 'Europe/London' },
  { file: '2026-27/en.2.json', id: 'english-championship', name: 'Championship', country: 'England', tz: 'Europe/London' },
  { file: '2026-27/es.1.json', id: 'spanish-la-liga', name: 'La Liga', country: 'Spain', tz: 'Europe/Madrid' },
  { file: '2026-27/it.1.json', id: 'italian-serie-a', name: 'Serie A', country: 'Italy', tz: 'Europe/Rome' },
  { file: '2026-27/de.1.json', id: 'german-bundesliga', name: 'Bundesliga', country: 'Germany', tz: 'Europe/Berlin' },
  { file: '2026-27/fr.1.json', id: 'french-ligue-1', name: 'Ligue 1', country: 'France', tz: 'Europe/Paris' },
  { file: '2026-27/nl.1.json', id: 'dutch-eredivisie', name: 'Eredivisie', country: 'Netherlands', tz: 'Europe/Amsterdam' },
  { file: '2026-27/pt.1.json', id: 'portuguese-primeira-liga', name: 'Primeira Liga', country: 'Portugal', tz: 'Europe/Lisbon' },
  { file: 'worldcup/2026/worldcup.json', id: 'fifa-world-cup', name: 'FIFA World Cup 2026', country: 'World', tz: 'UTC', season: '2026' },
  // Football.TXT files (openfootball/europe, belgium, austria, south-america). Times are local to the league.
  { file: 'txt/scotland/2026-27_sco1.txt', id: 'scottish-premiership', name: 'Scottish Premiership', country: 'Scotland', tz: 'Europe/London', format: 'txt' },
  { file: 'txt/turkey/2026-27_tr1.txt', id: 'turkish-super-lig', name: 'Süper Lig', country: 'Turkey', tz: 'Europe/Istanbul', format: 'txt' },
  { file: 'txt/greece/2026-27_gr1.txt', id: 'greek-super-league', name: 'Greek Super League', country: 'Greece', tz: 'Europe/Athens', format: 'txt' },
  { file: 'txt/switzerland/2026-27_ch1.txt', id: 'swiss-super-league', name: 'Swiss Super League', country: 'Switzerland', tz: 'Europe/Zurich', format: 'txt' },
  { file: 'txt/belgium/2026-27_be1.txt', id: 'belgian-pro-league', name: 'Belgian Pro League', country: 'Belgium', tz: 'Europe/Brussels', format: 'txt' },
  { file: 'txt/austria/2026-27_1-bundesliga.txt', id: 'austrian-bundesliga', name: 'Austrian Bundesliga', country: 'Austria', tz: 'Europe/Vienna', format: 'txt' },
  { file: 'txt/brazil/2026_br1.txt', id: 'brazilian-serie-a', name: 'Brasileirão', country: 'Brazil', tz: 'America/Sao_Paulo', season: '2026', format: 'txt' },
  {
    file: 'txt/copa-libertadores/2026_copal.txt',
    id: 'copa-libertadores',
    name: 'Copa Libertadores',
    country: 'South America',
    tz: 'America/Sao_Paulo',
    season: '2026',
    format: 'txt',
    note: 'The file does not state a time zone; kick-off times are read as UTC−3 (CONMEBOL schedules)',
  },
];

export interface OfMatch {
  round?: string;
  /** Missing when the source lists the fixture without a date ("date TBC"). */
  date?: string;
  time?: string;
  team1: string;
  team2: string;
  score?: { ft?: [number, number]; ht?: [number, number]; et?: [number, number]; p?: [number, number] };
  /** Marker in the source: postponed, abandoned, awarded, cancelled. */
  flag?: string;
}

const MONTH_IDX: Record<string, number> = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const pad2 = (n: number | string) => String(n).padStart(2, '0');

/**
 * Parses openfootball's Football.TXT format. Both layouts are handled:
 *   "  15:00   Celtic  1-0 (0-0)  Dundee"            (score between the teams)
 *   "    19:00  CA Mineiro  v SE Palmeiras  2-2 (1-1)" (score after the away team)
 * Goal-scorer blocks in parentheses are skipped; fixtures listed before any date keep no date.
 */
export function parseFootballTxt(text: string): { name?: string; matches: OfMatch[]; warnings: string[] } {
  const lines = text.replace(/\r/g, '').split('\n');
  const matches: OfMatch[] = [];
  const warnings: string[] = [];
  let name: string | undefined;
  let round: string | undefined;
  let year = 0;
  let lastMonth = -1;
  let date: string | undefined;
  let time: string | undefined;
  let depth = 0;
  const SCORE = '(\\d+)-(\\d+)(?:\\s*(pen\\.|a\\.e\\.t\\.|aet))?(?:\\s*\\(([^)]*)\\))?';
  const middle = new RegExp(`^(.+?)\\s{2,}${SCORE}\\s{2,}(.+)$`);
  const versus = new RegExp(`^(.+?)\\s+v\\s+(.+?)(?:\\s+${SCORE})?$`);
  const dateRe = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})(?:\s+(\d{4}))?$/;
  const pairs = (s: string | undefined) => (s ? (s.match(/\d+-\d+/g) || []).map((x) => x.split('-').map(Number) as [number, number]) : []);

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (depth > 0 || line.charAt(0) === '(') {
      depth += (line.match(/\(/g) || []).length - (line.match(/\)/g) || []).length;
      if (depth < 0) depth = 0;
      continue;
    }
    if (!line || line.charAt(0) === '#') continue;
    if (line.charAt(0) === '=') {
      name = line.replace(/^=+\s*/, '');
      const y = /(\d{4})(?:\/\d{2})?/.exec(name);
      if (y) year = Number(y[1]);
      continue;
    }
    if (/^[▪»▸]/.test(line)) {
      round = line.replace(/^[▪»▸]\s*/, '');
      // Every dated round starts with its own date line; rounds listed "date TBC" have none.
      date = undefined;
      time = undefined;
      continue;
    }
    const d = dateRe.exec(line);
    if (d) {
      const mo = MONTH_IDX[d[1]!]!;
      if (d[3]) year = Number(d[3]);
      else if (lastMonth >= 0 && mo < lastMonth) year++;
      lastMonth = mo;
      date = year ? `${year}-${pad2(mo + 1)}-${pad2(d[2]!)}` : undefined;
      time = undefined;
      continue;
    }
    let rest = line;
    const t = /^(\d{1,2})[:.](\d{2})\s+/.exec(rest);
    if (t) {
      time = `${pad2(t[1]!)}:${t[2]}`;
      rest = rest.slice(t[0].length);
    }
    let flag: string | undefined;
    const fl = /\s*\[([^\]]+)\]\s*$/.exec(rest);
    if (fl) {
      flag = fl[1]!.toLowerCase();
      rest = rest.slice(0, fl.index).trim();
    }
    let m: OfMatch | null = null;
    const a = middle.exec(rest);
    const b = a ? null : versus.exec(rest);
    const build = (home: string, away: string, s1?: string, s2?: string, marker?: string, paren?: string): OfMatch => {
      const out: OfMatch = { round, date, time: date ? time : undefined, team1: home.trim(), team2: away.trim() };
      if (s1 !== undefined && s2 !== undefined) {
        const main: [number, number] = [Number(s1), Number(s2)];
        const ps = pairs(paren);
        if (marker === 'pen.') out.score = { p: main, ft: ps[0], ht: ps[1] };
        else if (marker) out.score = { et: main, ft: ps[0], ht: ps[1] };
        else out.score = { ft: main, ht: ps[0] };
      }
      if (flag) out.flag = flag;
      return out;
    };
    if (a) m = build(a[1]!, a[6]!, a[2], a[3], a[4], a[5]);
    else if (b) m = build(b[1]!, b[2]!, b[3], b[4], b[5], b[6]);
    if (m && m.team1 && m.team2) matches.push(m);
    else if (/\S\s{2,}\S/.test(rest) || / v /.test(rest)) warnings.push(`line ${i + 1}: not understood: ${line.slice(0, 80)}`);
  }
  return { name, matches, warnings };
}

const TBD = (team: string) => (/^N\.?\s?N\.?$/i.test(team) ? 'To be decided' : team);

export function parseOpenfootball(data: { name?: string; matches?: OfMatch[] }, def: OpenfootballDef, now = Date.now()): Fixture[] {
  return (data.matches || []).map((m, i) => {
    const time = m.time && /^\d{1,2}:\d{2}/.test(m.time) ? pad2(m.time.split(':')[0]!) + ':' + m.time.split(':')[1]!.slice(0, 2) : undefined;
    // "13:00 UTC-6": the time carries its own offset (World Cup files).
    const off = m.time ? /UTC\s*([+-]\d{1,2})(?::?(\d{2}))?/.exec(m.time) : null;
    let kickoffUtc: string | undefined;
    if (m.date && time && off) {
      const sign = off[1]!.charAt(0) === '-' ? -1 : 1;
      const mins = Math.abs(Number(off[1])) * 60 + Number(off[2] || 0);
      kickoffUtc = new Date(Date.parse(`${m.date}T${time}:00Z`) - sign * mins * 60000).toISOString();
    } else if (m.date && time) kickoffUtc = zonedToUtc(m.date, time, def.tz);
    const sc = m.score || {};
    const ft = sc.et || sc.ft;
    const ht = sc.ht;
    const startMs = kickoffUtc ? Date.parse(kickoffUtc) : m.date ? Date.parse(`${m.date}T23:59:00Z`) : NaN;
    const flag = m.flag || '';
    const status = /postpon/.test(flag)
      ? 'postponed'
      : /abandon|abd/.test(flag)
        ? 'abandoned'
        : /cancel/.test(flag)
          ? 'cancelled'
          : ft
            ? 'finished'
            : !m.date
              ? 'date-tbc'
              : now > startMs + 3 * 3600000
                ? 'result-not-published'
                : now > startMs
                  ? 'kick-off-passed'
                  : 'scheduled';
    const home = TBD(m.team1);
    const away = TBD(m.team2);
    const f: Fixture = {
      id: `of:${def.id}:${i}`,
      sport: 'football',
      competitionId: def.id,
      competition: def.name,
      season: def.season || '2026-27',
      round: m.round,
      kickoffUtc,
      kickoffLocal: m.date ? { date: m.date, time, timeZone: off ? `UTC${off[1]}` : def.tz } : undefined,
      timeKnown: !!kickoffUtc,
      home,
      away,
      status,
      priority: fixturePriority(def.id, home, away),
      bigClubs: [home, away].filter(isBigClub),
      sources: [{ provider: 'openfootball', ref: `${def.file}#${i}` }],
      broadcasts: [],
    };
    if (ft) {
      f.score = { home: ft[0], away: ft[1], htHome: ht ? ht[0] : undefined, htAway: ht ? ht[1] : undefined };
      if (sc.et) f.score.afterExtraTime = true;
      if (sc.p) f.score.penalties = { home: sc.p[0], away: sc.p[1] };
    }
    if (flag) f.note = flag;
    return f;
  });
}

// ------------------------------------------------------------------ TheSportsDB
/**
 * How much of a competition to fetch beyond the free key's single next/past event:
 *  - rounds around the current one (`eventsround`, one request per round, complete rounds);
 *  - cups, whose rounds are numbered by teams remaining (128, 64, 32 …);
 *  - days ahead (`eventsday`), for leagues without rounds (NBA, NHL, MLB).
 */
export type TsdbScan = { back: number; ahead: number } | { cup: true } | { days: number };

export interface TsdbLeague {
  id: string;
  competitionId: string;
  expect: RegExp;
  sport: string;
  name: string;
  scan?: TsdbScan;
}

const EURO: TsdbScan = { back: 1, ahead: 4 };
const CUP: TsdbScan = { cup: true };
const COVERED: TsdbScan = { back: 0, ahead: 1 };
const LEAGUE: TsdbScan = { back: 1, ahead: 3 };
const SERIES: TsdbScan = { back: 0, ahead: 3 };
const DAYS: TsdbScan = { days: 4 };

export const TSDB_LEAGUES: TsdbLeague[] = [
  // UEFA and domestic cups
  { id: '4480', competitionId: 'uefa-champions-league', expect: /champions league/i, sport: 'football', name: 'UEFA Champions League' , scan: EURO },
  { id: '4481', competitionId: 'uefa-europa-league', expect: /europa league/i, sport: 'football', name: 'UEFA Europa League' , scan: EURO },
  { id: '5071', competitionId: 'uefa-conference-league', expect: /conference league/i, sport: 'football', name: 'UEFA Conference League' , scan: EURO },
  { id: '4482', competitionId: 'fa-cup', expect: /fa cup/i, sport: 'football', name: 'FA Cup' , scan: CUP },
  { id: '4570', competitionId: 'efl-cup', expect: /efl cup|league cup/i, sport: 'football', name: 'EFL Cup' , scan: CUP },
  { id: '4483', competitionId: 'copa-del-rey', expect: /copa del rey/i, sport: 'football', name: 'Copa del Rey' , scan: CUP },
  { id: '4485', competitionId: 'dfb-pokal', expect: /dfb|pokal/i, sport: 'football', name: 'DFB-Pokal' , scan: CUP },
  { id: '4506', competitionId: 'coppa-italia', expect: /coppa italia/i, sport: 'football', name: 'Coppa Italia' , scan: CUP },
  { id: '4484', competitionId: 'coupe-de-france', expect: /coupe de france/i, sport: 'football', name: 'Coupe de France' , scan: CUP },
  { id: '4490', competitionId: 'uefa-nations-league', expect: /nations league/i, sport: 'football', name: 'UEFA Nations League' , scan: { back: 0, ahead: 2 } },
  // Leagues (adds TV listings and badges to openfootball data, and leagues openfootball lacks)
  { id: '4328', competitionId: 'english-premier-league', expect: /premier league/i, sport: 'football', name: 'Premier League' , scan: COVERED },
  { id: '4329', competitionId: 'english-championship', expect: /championship/i, sport: 'football', name: 'Championship' , scan: COVERED },
  { id: '4335', competitionId: 'spanish-la-liga', expect: /la liga/i, sport: 'football', name: 'La Liga' , scan: COVERED },
  { id: '4332', competitionId: 'italian-serie-a', expect: /serie a/i, sport: 'football', name: 'Serie A' , scan: COVERED },
  { id: '4331', competitionId: 'german-bundesliga', expect: /bundesliga/i, sport: 'football', name: 'Bundesliga' , scan: COVERED },
  { id: '4334', competitionId: 'french-ligue-1', expect: /ligue 1/i, sport: 'football', name: 'Ligue 1' , scan: COVERED },
  { id: '4330', competitionId: 'scottish-premiership', expect: /scottish/i, sport: 'football', name: 'Scottish Premiership' , scan: COVERED },
  { id: '4339', competitionId: 'turkish-super-lig', expect: /turk|super lig/i, sport: 'football', name: 'Süper Lig' , scan: COVERED },
  { id: '4668', competitionId: 'saudi-pro-league', expect: /saudi/i, sport: 'football', name: 'Saudi Pro League' , scan: LEAGUE },
  { id: '4346', competitionId: 'american-mls', expect: /major league soccer|mls/i, sport: 'football', name: 'MLS' , scan: LEAGUE },
  { id: '4351', competitionId: 'brazilian-serie-a', expect: /brazil/i, sport: 'football', name: 'Brasileirão' , scan: COVERED },
  { id: '4406', competitionId: 'argentine-primera', expect: /argentin/i, sport: 'football', name: 'Liga Profesional (Argentina)' , scan: LEAGUE },
  // Other sports
  { id: '4370', competitionId: 'formula-1', expect: /formula 1/i, sport: 'motorsport', name: 'Formula 1' , scan: SERIES },
  { id: '4407', competitionId: 'motogp', expect: /motogp/i, sport: 'motorsport', name: 'MotoGP' , scan: SERIES },
  { id: '4409', competitionId: 'wrc', expect: /wrc|rally/i, sport: 'rally', name: 'World Rally Championship' , scan: SERIES },
  { id: '4387', competitionId: 'nba', expect: /nba/i, sport: 'basketball', name: 'NBA' , scan: DAYS },
  { id: '4391', competitionId: 'nfl', expect: /nfl/i, sport: 'american-football', name: 'NFL' , scan: SERIES },
  { id: '4424', competitionId: 'mlb', expect: /mlb/i, sport: 'baseball', name: 'MLB' , scan: DAYS },
  { id: '4380', competitionId: 'nhl', expect: /nhl/i, sport: 'ice-hockey', name: 'NHL' , scan: DAYS },
  { id: '4443', competitionId: 'ufc', expect: /ufc/i, sport: 'combat', name: 'UFC' , scan: SERIES },
  { id: '4460', competitionId: 'ipl', expect: /indian premier league/i, sport: 'cricket', name: 'Indian Premier League' },
];

const TSDB = 'https://www.thesportsdb.com/api/v1/json/123';
/**
 * The free key is throttled far below its documented 30/minute: bursts of roughly 8-18
 * requests trigger a Cloudflare block of 1.5-3 minutes, longer when repeated (FND-017). Requests
 * are paced and the pace slows after every block, instead of retrying into it.
 */
const SPACING_MS = 5500;
const HOUR = 3600000;
let lastCall = 0;
/** Grows after each block (Cloudflare lengthens repeat blocks), so the run slows instead of hammering. */
let spacing = SPACING_MS;

/**
 * `maxAgeMs`: reuse a stored response this recent instead of asking again — league details for
 * a month, schedules for a few hours (so an interrupted refresh resumes without re-asking).
 */
async function tsdb<T>(dir: string, endpoint: string, log: (m: string) => void, maxAgeMs = 3 * HOUR): Promise<T | null> {
  const file = join(dir, 'repositories/thesportsdb', `${endpoint.replace(/[^a-z0-9]+/gi, '_')}.json`);
  if (maxAgeMs && existsSync(file) && Date.now() - statSync(file).mtimeMs < maxAgeMs) {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T;
    } catch {
      // fall through and fetch again
    }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const wait = lastCall + spacing - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    try {
      const res = await fetch(`${TSDB}/${endpoint}`, { headers: { 'User-Agent': USER_AGENT } });
      const text = await res.text();
      if (res.status === 429 || !text.trim()) {
        // Blocked: wait the block out and slow down for the rest of the run.
        spacing = Math.min(Math.round(spacing * 1.5), 15000);
        log(`thesportsdb: throttled on ${endpoint.split('?')[0]}; waiting 120 s, then one request every ${(spacing / 1000).toFixed(1)} s`);
        await new Promise((r) => setTimeout(r, 120000));
        if (attempt === 2) log(`thesportsdb: gave up on ${endpoint} (throttled)${existsSync(file) ? '; using the stored response' : ''}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = JSON.parse(text) as T;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      return data;
    } catch (err) {
      if (attempt === 2) {
        log(`thesportsdb ${endpoint}: ${(err as Error).message}`);
        // Fall back to the last stored response, if any.
        return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
      }
    }
  }
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as T) : null;
}

interface TsdbEvent {
  idEvent: string;
  strEvent?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | null;
  intAwayScore?: string | null;
  strTimestamp?: string | null;
  dateEvent?: string;
  strTime?: string | null;
  intRound?: string | null;
  strSeason?: string;
  strStatus?: string | null;
  strHomeTeamBadge?: string | null;
  strAwayTeamBadge?: string | null;
  strPostponed?: string;
}

/** Cups number rounds by teams remaining; leagues by matchday. Pure. */
export function roundLabel(r: string | null | undefined, lg: TsdbLeague): string | undefined {
  const n = Number(r);
  if (!r || !n) return undefined;
  if (lg.scan && 'cup' in lg.scan && n >= 2 && (n & (n - 1)) === 0) return n === 2 ? 'Final' : n === 4 ? 'Semi-finals' : n === 8 ? 'Quarter-finals' : `Round of ${n}`;
  return `${lg.sport === 'football' && !(lg.scan && 'cup' in lg.scan) ? 'Matchday' : 'Round'} ${n}`;
}

/** Rounds to request for a scan, given the rounds of the next and last events. Pure. */
export function roundsToFetch(scan: TsdbScan | undefined, nextR: number, pastR: number): number[] {
  if (!scan || 'days' in scan || !nextR) return [];
  const out: number[] = [];
  if ('cup' in scan) {
    out.push(nextR);
    out.push(nextR >= 4 && (nextR & (nextR - 1)) === 0 ? nextR / 2 : nextR + 1);
    if (pastR && pastR !== nextR) out.push(pastR);
  } else {
    for (let r = Math.max(1, Math.min(nextR, pastR || nextR) - scan.back); r <= nextR + scan.ahead; r++) out.push(r);
  }
  return out.filter((r, i) => r > 0 && out.indexOf(r) === i).slice(0, 8);
}

export function fromTsdbEvent(e: TsdbEvent, lg: TsdbLeague): Fixture {
  const home = e.strHomeTeam || '';
  const away = e.strAwayTeam || '';
  const ts = e.strTimestamp ? (/[zZ]|[+-]\d\d:?\d\d$/.test(e.strTimestamp) ? e.strTimestamp : `${e.strTimestamp}Z`) : e.dateEvent && e.strTime ? `${e.dateEvent}T${e.strTime}Z` : undefined;
  const scored = e.intHomeScore != null && e.intHomeScore !== '' && e.intAwayScore != null && e.intAwayScore !== '';
  const f: Fixture = {
    id: `tsdb:${e.idEvent}`,
    sport: lg.sport,
    competitionId: lg.competitionId,
    competition: lg.name,
    season: e.strSeason,
    round: roundLabel(e.intRound, lg),
    kickoffUtc: ts ? new Date(ts).toISOString() : undefined,
    timeKnown: !!ts,
    home,
    away,
    event: e.strEvent,
    status: e.strPostponed === 'yes' ? 'postponed' : scored ? 'finished' : e.strStatus && !/not started|ns/i.test(e.strStatus) ? e.strStatus : 'scheduled',
    priority: lg.sport === 'football' ? fixturePriority(lg.competitionId, home, away) : 40,
    bigClubs: lg.sport === 'football' ? [home, away].filter(isBigClub) : [],
    sources: [{ provider: 'thesportsdb', ref: `event/${e.idEvent}` }],
    broadcasts: [],
  };
  if (e.strHomeTeamBadge) f.homeBadge = e.strHomeTeamBadge;
  if (e.strAwayTeamBadge) f.awayBadge = e.strAwayTeamBadge;
  if (scored) f.score = { home: Number(e.intHomeScore), away: Number(e.intAwayScore) };
  return f;
}

const dayOf = (f: Fixture) => (f.kickoffUtc || (f.kickoffLocal ? f.kickoffLocal.date : '')).slice(0, 10);

/** Days between two fixtures' dates, or Infinity when either has no date. Pure. */
export function dayGap(a: Fixture, b: Fixture): number {
  const da = dayOf(a);
  const db = dayOf(b);
  return da && db ? Math.abs(Date.parse(da) - Date.parse(db)) / 86400000 : Infinity;
}

/**
 * Same match from two providers: same competition, the same home and away clubs (names compared
 * by tokens, FND-021) and dates at most 4 days apart — schedules without confirmed kick-offs
 * sit on placeholder dates. A club plays the same home fixture once in that window. Pure.
 */
export function sameMatch(a: Fixture, b: Fixture): boolean {
  if (a.competitionId !== b.competitionId) return false;
  const gap = dayGap(a, b);
  // A rescheduled league match keeps its round number ("1st Phase - 12" / "Matchday 12").
  const ra = roundNo(a);
  const sameRound = ra !== null && ra === roundNo(b) && !/round of|final/i.test(`${a.round} ${b.round}`);
  if (gap > 4 && !(sameRound && gap <= 45)) return false;
  return sameTeam(a.home, b.home) && sameTeam(a.away, b.away);
}

function roundNo(f: Fixture): number | null {
  const m = f.round ? /(\d+)\s*$/.exec(f.round) : null;
  return m ? Number(m[1]) : null;
}

export interface FixtureResult {
  generatedAt: string;
  competitions: CompetitionInfo[];
  fixtures: Fixture[];
  notes: string[];
}

export async function collectFixtures(dir: string, log: (m: string) => void, opts: { offline?: boolean; listings?: number } = {}): Promise<FixtureResult> {
  const now = Date.now();
  const competitions: CompetitionInfo[] = [];
  const fixtures: Fixture[] = [];

  for (const def of OPENFOOTBALL) {
    const p = join(dir, 'repositories/openfootball', def.file);
    if (!existsSync(p)) {
      competitions.push({ id: def.id, name: def.name, sport: 'football', country: def.country, tier: 0, providers: ['openfootball'], fixtures: 0, verified: false, error: 'file not downloaded' });
      continue;
    }
    const text = readFileSync(p, 'utf8');
    let parsed: { matches?: OfMatch[] };
    if (def.format === 'txt') {
      const r = parseFootballTxt(text);
      for (const w of r.warnings.slice(0, 5)) log(`openfootball ${def.file}: ${w}`);
      if (r.warnings.length > 5) log(`openfootball ${def.file}: ${r.warnings.length - 5} more lines not understood`);
      parsed = r;
    } else parsed = JSON.parse(text);
    const list = parseOpenfootball(parsed, def, now);
    fixtures.push(...list);
    const undated = list.filter((f) => f.status === 'date-tbc').length;
    const info: CompetitionInfo = { id: def.id, name: def.name, sport: 'football', country: def.country, tier: 0, providers: ['openfootball'], fixtures: list.length, verified: true };
    const notes = [def.note, undated ? `${undated} fixture(s) listed without a date in the source` : ''].filter(Boolean);
    if (notes.length) info.note = notes.join('; ');
    competitions.push(info);
  }

  if (!opts.offline) {
    const league = async (lg: TsdbLeague, retry: boolean): Promise<boolean> => {
      const info = await tsdb<{ leagues?: { strLeague?: string; strCountry?: string }[] }>(dir, `lookupleague.php?id=${lg.id}`, log, 30 * 24 * HOUR);
      const actual = info && info.leagues && info.leagues[0] ? info.leagues[0].strLeague || '' : '';
      let comp = competitions.filter((c) => c.id === lg.competitionId)[0];
      if (!comp) {
        comp = { id: lg.competitionId, name: lg.name, sport: lg.sport, country: info && info.leagues && info.leagues[0] ? info.leagues[0].strCountry : undefined, tier: 0, providers: [], fixtures: 0, verified: false };
        competitions.push(comp);
      }
      if (!info) {
        // No answer at all (rate limited) is not a mismatch: retry once later, then record it honestly.
        if (!retry) return false;
        comp.error = `TheSportsDB did not answer for id ${lg.id} (rate limited); not verified, events not used. Run "npm run library:fixtures" later.`;
        log(comp.error);
        return true;
      }
      if (!lg.expect.test(actual)) {
        comp.error = `TheSportsDB id ${lg.id} is "${actual || 'unknown'}", not ${lg.name}; not used`;
        log(comp.error);
        return true;
      }
      delete comp.error;
      comp.verified = true;
      comp.providers.push('thesportsdb');
      let added = 0;
      const add = (e: TsdbEvent) => {
        const f = fromTsdbEvent(e, lg);
        const tsdbId = f.id.slice(5);
        if (fixtures.some((x) => x.id === f.id || (x as Fixture & { tsdbId?: string }).tsdbId === tsdbId)) return;
        const twin = fixtures.filter((x) => sameMatch(x, f)).sort((x, y) => dayGap(x, f) - dayGap(y, f))[0];
        if (twin) {
          // Merge: keep openfootball's record, add TheSportsDB's badges, UTC time and status.
          twin.sources.push(f.sources[0]!);
          if (!twin.homeBadge && f.homeBadge) twin.homeBadge = f.homeBadge;
          if (!twin.awayBadge && f.awayBadge) twin.awayBadge = f.awayBadge;
          if (f.kickoffUtc) {
            if (!twin.timeKnown || dayGap(twin, f) <= 1) {
              twin.kickoffUtc = f.kickoffUtc;
              twin.timeKnown = true;
            } else {
              // The providers disagree on a rescheduled match: keep the confirmed date, note the other.
              twin.note = `TheSportsDB lists ${f.kickoffUtc.slice(0, 10)}`;
            }
          }
          if (f.score && !twin.score) twin.score = f.score;
          if (f.status !== 'scheduled') twin.status = f.status;
          (twin as Fixture & { tsdbId?: string }).tsdbId = tsdbId;
        } else {
          (f as Fixture & { tsdbId?: string }).tsdbId = tsdbId;
          fixtures.push(f);
          added++;
        }
      };
      const next = await tsdb<{ events?: TsdbEvent[] | null }>(dir, `eventsnextleague.php?id=${lg.id}`, log);
      const past = await tsdb<{ events?: TsdbEvent[] | null }>(dir, `eventspastleague.php?id=${lg.id}`, log);
      const nextEv = (next && next.events) || [];
      const pastEv = (past && past.events) || [];
      for (const e of nextEv.concat(pastEv)) add(e);
      // Whole rounds (or days) around now: the free key's next/past lists hold one event each.
      const nextR = nextEv.length ? Number(nextEv[0]!.intRound) || 0 : 0;
      const pastR = pastEv.length && pastEv[0]!.strSeason === (nextEv[0] && nextEv[0].strSeason) ? Number(pastEv[0]!.intRound) || 0 : 0;
      const season = nextEv[0] && nextEv[0].strSeason;
      let requests = 0;
      if (season) {
        for (const r of roundsToFetch(lg.scan, nextR, pastR)) {
          const data = await tsdb<{ events?: TsdbEvent[] | null }>(dir, `eventsround.php?id=${lg.id}&r=${r}&s=${season}`, log);
          requests++;
          for (const e of (data && data.events) || []) add(e);
        }
      }
      if (lg.scan && 'days' in lg.scan && nextEv.length) {
        for (let d = 0; d < lg.scan.days; d++) {
          const day = new Date(now + d * 86400000).toISOString().slice(0, 10);
          const data = await tsdb<{ events?: TsdbEvent[] | null }>(dir, `eventsday.php?d=${day}&l=${lg.id}`, log);
          requests++;
          for (const e of (data && data.events) || []) add(e);
        }
      }
      if (requests) log(`thesportsdb ${lg.name}: ${requests} round/day request(s)`);
      comp.fixtures += added;
      log(`thesportsdb ${lg.name}: ${added} new events`);
      return true;
    };
    const retryLater: TsdbLeague[] = [];
    for (const lg of TSDB_LEAGUES) if (!(await league(lg, false))) retryLater.push(lg);
    if (retryLater.length) {
      log(`thesportsdb: no answer for ${retryLater.map((l) => l.name).join(', ')}; retrying after a 90 s pause`);
      await new Promise((r) => setTimeout(r, 90000));
      for (const lg of retryLater) await league(lg, true);
    }

    // TV listings for the highest-priority upcoming matches (one request each).
    const upcoming = fixtures
      .filter((f) => (f as Fixture & { tsdbId?: string }).tsdbId && f.kickoffUtc && Date.parse(f.kickoffUtc) > now - 3 * 3600000)
      .sort((a, b) => b.priority - a.priority || Date.parse(a.kickoffUtc!) - Date.parse(b.kickoffUtc!))
      .slice(0, opts.listings === undefined ? 40 : opts.listings);
    for (const f of upcoming) {
      const id = (f as Fixture & { tsdbId?: string }).tsdbId!;
      const tv = await tsdb<{ tvevent?: { strChannel?: string; strCountry?: string }[] | null }>(dir, `lookuptv.php?id=${id}`, log);
      for (const t of (tv && tv.tvevent) || []) if (t.strChannel) f.broadcasts.push({ channel: t.strChannel, country: t.strCountry, source: 'thesportsdb' });
    }
    log(`thesportsdb: TV listings fetched for ${upcoming.length} matches`);
  }

  for (const c of competitions) c.tier = COMPETITION_TIER[c.id] || (c.sport === 'football' ? 35 : 40);
  fixtures.sort((a, b) => (a.kickoffUtc || '9') < (b.kickoffUtc || '9') ? -1 : 1);
  const result: FixtureResult = {
    generatedAt: new Date(now).toISOString(),
    competitions,
    fixtures,
    notes: [
      'Schedules come from openfootball (public domain) and TheSportsDB (free key). Neither provides live scores on these tiers; "kick-off-passed" means the start time has passed, not that the match is live.',
      'Future kick-off times can change for broadcast selections. Matches without a time show "TBC".',
      'TV listings are third-party listings by country; FBTV does not verify them and never assumes a stream carries a match.',
    ],
  };
  writeFileSync(join(dir, 'catalogs/fixtures.json'), JSON.stringify(result, null, 2));
  return result;
}
