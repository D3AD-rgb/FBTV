/**
 * Football and sports data on the TV, from the library export (catalogs built on the PC).
 * Fixtures are schedule data only; "started" means the kick-off time has passed — FBTV has no
 * verified live feed without a football-data.org key, and never assumes a channel shows a match.
 */
import { signal } from '@preact/signals';
import { loadCatalog, loadShard, type LibChannel } from './sourceLibrary.ts';
import { sameTeam } from '../../shared/teams.ts';
import { servicesFor } from '../platform/apps.ts';

export interface Broadcast {
  country?: string;
  channel: string;
}

export interface Fixture {
  id: string;
  sport: string;
  competitionId: string;
  competition: string;
  round?: string;
  kickoffUtc?: string;
  kickoffLocal?: { date: string; time?: string };
  timeKnown: boolean;
  home: string;
  away: string;
  homeBadge?: string;
  awayBadge?: string;
  event?: string;
  status: string;
  score?: { home: number; away: number; afterExtraTime?: boolean; penalties?: { home: number; away: number } };
  /** Source marker such as postponed or awarded. */
  note?: string;
  priority: number;
  bigClubs: string[];
  broadcasts: Broadcast[];
}

export interface RightsChannel {
  name: string;
  type: 'free-to-air' | 'free-stream' | 'pay-tv' | 'streaming';
  freeToAir: boolean;
  library?: { id: string; name: string; playable: boolean; country?: string }[];
}

export interface RightsEntry {
  country: string;
  code: string;
  channels: RightsChannel[];
  note?: string;
  source?: string;
}

export interface CompetitionRights {
  competitionId: string;
  season: string;
  retrieved: string;
  sources: string[];
  notes?: string;
  broadcasters: RightsEntry[];
}

export interface Competition {
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
  /** Rights holders by country (researched, with sources). */
  rights?: CompetitionRights;
}

export interface Association {
  fixture: string;
  listed: Broadcast[];
  nameMatches: { listing: string; country?: string; channels: { id: string; name: string; playable: boolean }[] }[];
}

export interface FootballData {
  notes: string[];
  channels: { id: string; role: string; playable: boolean }[];
  competitions: Competition[];
  fixtures: Fixture[];
  associations: Association[];
}

export interface SportsData {
  sports: { id: string; name: string; channels: { id: string; name: string; playable: boolean }[] }[];
  events: Fixture[];
  competitions?: Competition[];
}

export const football = signal<FootballData | null>(null);
export const sportsData = signal<SportsData | null>(null);
export const footballStatus = signal<'idle' | 'loading' | 'ready' | 'missing'>('idle');

export async function loadFootball(): Promise<void> {
  if (footballStatus.value === 'loading' || footballStatus.value === 'ready') return;
  footballStatus.value = 'loading';
  const [f, s] = await Promise.all([loadCatalog<FootballData>('football.json'), loadCatalog<SportsData>('sports.json')]);
  football.value = f;
  sportsData.value = s;
  footballStatus.value = f ? 'ready' : 'missing';
}

/** Library channels by id (primary shard first; the secondary shard only when asked). */
export async function channelsById(includeSecondary: boolean): Promise<Map<string, LibChannel>> {
  const m = new Map<string, LibChannel>();
  for (const c of await loadShard('primary')) m.set(c.id, c);
  if (includeSecondary) for (const c of await loadShard('secondary')) if (!m.has(c.id)) m.set(c.id, c);
  return m;
}

// ------------------------------------------------------------------ views (pure)
const H = 3600000;

export type MatchState = 'started' | 'finished' | 'upcoming' | 'tbc' | 'postponed' | 'awaiting-result';

export function matchState(f: Fixture, now = Date.now()): MatchState {
  if (f.status === 'postponed' || f.status === 'abandoned' || f.status === 'cancelled') return 'postponed';
  if (f.score || f.status === 'finished') return 'finished';
  if (!f.kickoffUtc) return 'tbc';
  const t = Date.parse(f.kickoffUtc);
  if (now < t) return 'upcoming';
  if (now < t + 2.5 * H) return 'started';
  return 'awaiting-result';
}

/** Sort key: UTC kick-off, else the local date, else last. */
export function timeKey(f: Fixture): string {
  return f.kickoffUtc || (f.kickoffLocal ? f.kickoffLocal.date : '9');
}

export function byPriorityThenTime(a: Fixture, b: Fixture): number {
  return b.priority - a.priority || (a.kickoffUtc || '9').localeCompare(b.kickoffUtc || '9');
}

export function byTime(a: Fixture, b: Fixture): number {
  return timeKey(a).localeCompare(timeKey(b));
}

function sameLocalDay(iso: string, now: number): boolean {
  const a = new Date(iso);
  const b = new Date(now);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export interface FootballViews {
  started: Fixture[];
  today: Fixture[];
  topWeek: Fixture[];
  results: Fixture[];
  byCompetition: { competition: Competition; upcoming: Fixture[]; results: Fixture[] }[];
}

export function footballViews(data: FootballData, now = Date.now()): FootballViews {
  const fx = data.fixtures.filter((f) => f.sport === 'football');
  const started = fx.filter((f) => matchState(f, now) === 'started').sort(byPriorityThenTime);
  const today = fx.filter((f) => f.kickoffUtc && sameLocalDay(f.kickoffUtc, now) && matchState(f, now) === 'upcoming').sort(byPriorityThenTime);
  const week = now + 7 * 24 * H;
  const topWeek = fx
    .filter((f) => matchState(f, now) === 'upcoming' && Date.parse(f.kickoffUtc!) < week)
    .sort(byPriorityThenTime)
    .slice(0, 30);
  const results = fx
    .filter((f) => matchState(f, now) === 'finished' && f.kickoffUtc && now - Date.parse(f.kickoffUtc) < 10 * 24 * H)
    .sort((a, b) => (b.kickoffUtc || '').localeCompare(a.kickoffUtc || '') || b.priority - a.priority)
    .slice(0, 40);
  const comps = data.competitions.filter((c) => c.sport === 'football' && c.fixtures > 0).sort((a, b) => b.tier - a.tier);
  const byCompetition = comps.map((c) => {
    const own = fx.filter((f) => f.competitionId === c.id);
    return {
      competition: c,
      upcoming: own.filter((f) => { const s = matchState(f, now); return s === 'upcoming' || s === 'tbc' || s === 'started'; }).sort(byTime).slice(0, 40),
      results: own.filter((f) => matchState(f, now) === 'finished').sort((a, b) => timeKey(b).localeCompare(timeKey(a))).slice(0, 20),
    };
  });
  return { started, today, topWeek, results, byCompetition };
}

export interface ClubView {
  club: string;
  /** Started, upcoming and date-TBC matches, soonest first. */
  upcoming: Fixture[];
  /** Latest results first. */
  results: Fixture[];
}

/** Every match of each followed club across all competitions. Pure. */
export function clubViews(data: FootballData, clubs: string[], now = Date.now()): ClubView[] {
  const fx = data.fixtures.filter((f) => f.sport === 'football');
  return clubs.map((club) => {
    const own = fx.filter((f) => sameTeam(club, f.home) || sameTeam(club, f.away));
    return {
      club,
      upcoming: own.filter((f) => { const s = matchState(f, now); return s === 'upcoming' || s === 'tbc' || s === 'started'; }).sort(byTime),
      results: own.filter((f) => matchState(f, now) === 'finished').sort((a, b) => timeKey(b).localeCompare(timeKey(a))),
    };
  });
}

/** Clubs per competition (one name per club, as the first provider writes it), for the follow picker. Pure. */
export function teamsByCompetition(data: FootballData): { competition: Competition; teams: string[] }[] {
  const out: { competition: Competition; teams: string[] }[] = [];
  for (const c of data.competitions.filter((x) => x.sport === 'football' && x.fixtures > 0).sort((a, b) => b.tier - a.tier)) {
    const teams: string[] = [];
    for (const f of data.fixtures) {
      if (f.competitionId !== c.id) continue;
      for (const t of [f.home, f.away]) if (t && t !== 'To be decided' && !teams.some((x) => sameTeam(x, t))) teams.push(t);
    }
    teams.sort((a, b) => a.localeCompare(b));
    if (teams.length) out.push({ competition: c, teams });
  }
  return out;
}

/** Not finished and still ahead (or kicked off within the last 3 hours); undated fixtures never count. Pure. */
export function isAhead(f: Fixture, now = Date.now()): boolean {
  if (matchState(f, now) === 'finished') return false;
  if (f.kickoffUtc) return Date.parse(f.kickoffUtc) > now - 3 * H;
  return !!f.kickoffLocal && Date.parse(`${f.kickoffLocal.date}T23:59:59Z`) > now;
}

/** All football matches in time order, and the index of the first one not yet finished. Pure. */
export function allMatches(data: FootballData, now = Date.now()): { list: Fixture[]; firstUpcoming: number } {
  const list = data.fixtures.filter((f) => f.sport === 'football' && (f.kickoffUtc || f.kickoffLocal)).sort(byTime);
  let firstUpcoming = list.findIndex((f) => isAhead(f, now));
  if (firstUpcoming < 0) firstUpcoming = Math.max(0, list.length - 1);
  return { list, firstUpcoming };
}

/** Home country first, then alphabetical; regional deals last. Pure. */
export function sortRights(list: RightsEntry[], home: string): RightsEntry[] {
  const h = home.toUpperCase();
  const rank = (b: RightsEntry) => (b.code === h || (h === 'UK' && b.code === 'GB') ? 0 : b.code === 'REGION' ? 2 : 1);
  return list.slice().sort((a, b) => rank(a) - rank(b) || a.country.localeCompare(b.country));
}

/** Playable library channels linked from rights holders, home country first. Pure. */
export function playableFromRights(r: CompetitionRights | undefined, map: Map<string, LibChannel> | null, home: string): LibChannel[] {
  if (!r || !map) return [];
  const out: LibChannel[] = [];
  for (const b of sortRights(r.broadcasters, home))
    for (const c of b.channels)
      for (const l of c.library || []) {
        const ch = map.get(l.id);
        if (ch && ch.playable && out.indexOf(ch) < 0) out.push(ch);
      }
  return out;
}

/**
 * Channels for followed clubs: the club's own TV first, then every rights holder with a public
 * stream in the library for the competitions of the club's next matches (home country first). Pure.
 */
export function clubChannels(data: FootballData, clubs: string[], map: Map<string, LibChannel>, home: string, now = Date.now()): LibChannel[] {
  const out: LibChannel[] = [];
  const add = (c: LibChannel | undefined) => {
    if (c && out.indexOf(c) < 0) out.push(c);
  };
  for (const club of clubs)
    for (const c of data.channels) if (c.role === 'club') {
      const ch = map.get(c.id);
      if (ch && sameTeam(club, ch.name)) add(ch);
    }
  const comps: string[] = [];
  for (const v of clubViews(data, clubs, now)) for (const f of v.upcoming.slice(0, 8)) if (comps.indexOf(f.competitionId) < 0) comps.push(f.competitionId);
  for (const id of comps) {
    const comp = data.competitions.filter((c) => c.id === id)[0];
    for (const ch of playableFromRights(comp && comp.rights, map, home)) add(ch);
  }
  return out;
}

/** A free channel the country note says shows highlights (so it does not read as free live coverage). */
export function highlightsOnly(c: RightsChannel, b: RightsEntry): boolean {
  const note = (b.note || '').toLowerCase();
  if (note.indexOf('highlight') < 0) return false;
  const free = b.channels.filter((x) => x.freeToAir);
  return note.indexOf(c.name.toLowerCase()) >= 0 || free.length === 1;
}

export interface WhereToWatch {
  /** Streaming services (labels from SERVICES) that show it, or may show it when not exact. */
  services: string[];
  /** Channel or broadcaster names behind them. */
  channels: string[];
  /** From this match's own TV listing (true) or from the competition's rights holders (false). */
  exact: boolean;
  /** UK Saturday 3pm blackout: not shown live in the UK. */
  blackout: boolean;
}

const HOME_COUNTRY_NAMES: Record<string, RegExp> = { UK: /united kingdom|england|scotland|wales|\buk\b|great britain/i };

/** True for a Premier League match kicking off 14:45–15:15 on a Saturday, UK time. Pure. */
export function ukBlackout(f: Fixture): boolean {
  if (f.competitionId !== 'english-premier-league' || !f.kickoffUtc) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(f.kickoffUtc));
  const get = (t: string) => (parts.filter((p) => p.type === t)[0] || { value: '' }).value;
  const mins = Number(get('hour')) * 60 + Number(get('minute'));
  return get('weekday') === 'Sat' && mins >= 14 * 60 + 45 && mins <= 15 * 60 + 15;
}

/** Where a match can be watched in the viewer's country, from listings or rights. Pure. */
export function whereToWatch(f: Fixture, data: FootballData, home: string): WhereToWatch {
  const code = home.toUpperCase();
  const blackout = code === 'UK' && ukBlackout(f);
  const names = HOME_COUNTRY_NAMES[code];
  const listed = names ? f.broadcasts.filter((b) => names.test(b.country || '')).map((b) => b.channel) : [];
  if (listed.length) return { services: servicesFor(listed).map((s) => s.label), channels: listed, exact: true, blackout };
  const comp = data.competitions.filter((c) => c.id === f.competitionId)[0];
  const entry = comp && comp.rights ? comp.rights.broadcasters.filter((b) => b.code === code || (code === 'UK' && b.code === 'GB'))[0] : undefined;
  const channels = entry ? entry.channels.filter((c) => !/highlights/i.test(c.name) && !(c.freeToAir && highlightsOnly(c, entry))).map((c) => c.name) : [];
  return { services: servicesFor(channels).map((s) => s.label), channels, exact: false, blackout };
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sat 31 Oct · 12:30" in the TV's time zone; date only with "TBC" when no time is known. */
export function kickoffLabel(f: Fixture): string {
  if (f.kickoffUtc) {
    const d = new Date(f.kickoffUtc);
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  if (f.kickoffLocal) {
    const [y, m, dd] = f.kickoffLocal.date.split('-').map(Number) as [number, number, number];
    const d = new Date(y, m - 1, dd);
    return `${DAYS[d.getDay()]} ${dd} ${MONTHS[m - 1]} · time TBC`;
  }
  return 'Date TBC';
}

export const COMPETITION_COLOUR: Record<string, string> = {
  'uefa-champions-league': '#3B82F6',
  'english-premier-league': '#8B5CF6',
  'spanish-la-liga': '#EF4444',
  'uefa-europa-league': '#F59E0B',
  'italian-serie-a': '#10B981',
  'german-bundesliga': '#DC2626',
  'french-ligue-1': '#0EA5E9',
  'fa-cup': '#E11D48',
  'efl-cup': '#22C55E',
  'copa-del-rey': '#F97316',
  'uefa-conference-league': '#14B8A6',
};
