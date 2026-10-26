/**
 * Club-name matching shared by the PC library and the TV: providers name clubs differently
 * ("US Lecce" / "Lecce", "FC Internazionale Milano" / "Inter Milan", FND-021).
 */
import { fold } from './normalize.ts';

/** Letters NFD does not decompose (Turkish dotless i, ß, ø, æ, đ). */
export function foldExtra(s: string): string {
  return s.replace(/ı/g, 'i').replace(/ß/g, 'ss').replace(/[øØ]/g, 'o').replace(/[æÆ]/g, 'ae').replace(/[đĐ]/g, 'd');
}

/** Club-form words, sponsor-free: dropped before comparing names from different providers. */
const TEAM_STOP = new Set(
  'fc afc cf sc ac ss ssc as rc rcd cd ud sd sv vfl vfb tsg fsv fk sk bk nk club clube calcio de la el del do da des di of the us acf cfc ogc aj es fbc fbpa ec se cr osc af ca cp sad and e y'.split(' '),
);
/** Whole-name differences between providers (after folding). */
const TEAM_PHRASE: [RegExp, string][] = [
  [/\bca mineiro\b/, 'atletico mineiro'],
  [/\bca paranaense\b/, 'athletico paranaense'],
  [/\binternazionale\b/, 'inter'],
  [/\bstade rennais\b/, 'rennes'],
  [/\bstade brestois\b/, 'brest'],
  [/\bmunchen\b/, 'munich'],
  [/\bsaint\b/g, 'st'],
  // Short names used by channels and some providers.
  [/\bman city\b/, 'manchester city'],
  [/\bman (utd|united)\b/, 'manchester united'],
  [/\bmutv\b/, 'manchester united tv'],
  [/\blfc\b/, 'liverpool'],
  [/\bspurs\b/, 'tottenham hotspur'],
  [/\bwolves\b/, 'wolverhampton wanderers'],
  [/\bbarca\b/, 'barcelona'],
  [/\blyonnais\b/, 'lyon'],
  [/\bparis st germain\b/, 'psg paris st germain'],
];
/** A token on one side only that makes two names different clubs (Inter v AC Milan, Dundee v Dundee United, PSG v Paris FC, Espanyol v Barcelona). */
const TEAM_DISTINCT = ['inter', 'united', 'city', 'atletico', 'athletic', 'sporting', 'espanyol', 'germain', 'psg', 'b', 'ii', 'women', 'u21', 'u23'];

export function teamTokens(name: string): string[] {
  let s = fold(foldExtra(name));
  for (const [re, to] of TEAM_PHRASE) s = s.replace(re, to);
  return s.split(' ').filter((t) => t && !TEAM_STOP.has(t) && !/^\d+$/.test(t));
}

/** True when two providers' names denote the same club ("US Lecce" ~ "Lecce", "Bayer 04 Leverkusen" ~ "Bayer Leverkusen"). Pure. */
export function sameTeam(a: string, b: string): boolean {
  const A = teamTokens(a);
  const B = teamTokens(b);
  if (!A.length || !B.length) return fold(foldExtra(a)) === fold(foldExtra(b));
  for (const d of TEAM_DISTINCT) if ((A.indexOf(d) >= 0) !== (B.indexOf(d) >= 0)) return false;
  const tok = (t: string, u: string) => t === u || (Math.min(t.length, u.length) >= 5 && (t.indexOf(u) === 0 || u.indexOf(t) === 0));
  const covers = (small: string[], big: string[]) => small.every((t) => big.some((u) => tok(t, u)));
  return covers(A, B) || covers(B, A);
}

