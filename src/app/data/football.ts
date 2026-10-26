/**
 * Football and sports data on the TV, from the library export (catalogs built on the PC).
 * Fixtures are schedule data only; "started" means the kick-off time has passed — FBTV has no
 * verified live feed without a football-data.org key, and never assumes a channel shows a match.
 */
import { signal } from '@preact/signals';
import { loadCatalog, loadShard, type LibChannel } from './sourceLibrary.ts';

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
