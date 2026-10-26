/**
 * Broadcast rights holders per competition and country (config/broadcasters/<competition>.json),
 * researched from official league / UEFA "where to watch" pages and reputable sources, each entry
 * with its source URL. Rights data says who may show a competition, not which channel shows a
 * given match.
 *
 * Each listed channel is linked to library channels with the same name in the same country (or any
 * country for regional deals). Only channels with a public stream are in the library index:
 * withheld pay-TV relays never are, so a link means "this broadcaster's own public stream".
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';

export interface RightsChannel {
  name: string;
  type: 'free-to-air' | 'free-stream' | 'pay-tv' | 'streaming';
  freeToAir: boolean;
  /** Library channels with the same name in that country. */
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

const TYPES = ['free-to-air', 'free-stream', 'pay-tv', 'streaming'];

/** Reads and validates the researched rights files; invalid entries are reported, not guessed. */
export function loadRights(log: (m: string) => void, dir = join(REPO_ROOT, 'config', 'broadcasters')): Map<string, CompetitionRights> {
  const out = new Map<string, CompetitionRights>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    try {
      const r = JSON.parse(readFileSync(join(dir, f), 'utf8')) as CompetitionRights;
      if (!r.competitionId || !Array.isArray(r.broadcasters)) throw new Error('missing competitionId or broadcasters');
      let dropped = 0;
      r.broadcasters = r.broadcasters
        .map((b) => ({
          ...b,
          code: String(b.code || '').toUpperCase(),
          channels: (b.channels || []).filter((c) => {
            const ok = !!c && typeof c.name === 'string' && c.name.trim() !== '' && TYPES.indexOf(c.type) >= 0;
            if (!ok) dropped++;
            return ok;
          }),
        }))
        .filter((b) => b.country && b.channels.length);
      if (dropped) log(`broadcasters ${f}: ${dropped} channel entr${dropped === 1 ? 'y' : 'ies'} without a name or a known type ignored`);
      out.set(r.competitionId, r);
    } catch (err) {
      log(`broadcasters ${f}: unreadable (${(err as Error).message})`);
    }
  }
  return out;
}

/** Library channel as the linker sees it. */
export interface LinkableChannel {
  id: string;
  name: string;
  country?: string;
  playable: boolean;
}

/** Attaches library channels with the broadcaster's name in that country. Pure. */
export function linkRights(r: CompetitionRights, index: Map<string, LinkableChannel[]>, norm: (s: string) => string): CompetitionRights {
  return {
    ...r,
    broadcasters: r.broadcasters.map((b) => ({
      ...b,
      channels: b.channels.map((c) => {
        const regional = b.code === 'REGION';
        const lib = (index.get(norm(c.name)) || []).filter((x) => regional || (x.country || '').toUpperCase() === b.code || (b.code === 'GB' && x.country === 'UK'));
        const out: RightsChannel = { name: c.name, type: c.type, freeToAir: !!c.freeToAir };
        if (lib.length) out.library = lib.slice(0, 6).map((x) => ({ id: x.id, name: x.name, playable: x.playable, country: x.country }));
        return out;
      }),
    })),
  };
}

/** Counts for the report. Pure. */
export function rightsSummary(all: CompetitionRights[]): { competitions: number; countries: number; channels: number; freeToAir: number; linked: number; playable: number } {
  let countries = 0;
  let channels = 0;
  let freeToAir = 0;
  let linked = 0;
  let playable = 0;
  for (const r of all) {
    countries += r.broadcasters.length;
    for (const b of r.broadcasters)
      for (const c of b.channels) {
        channels++;
        if (c.freeToAir) freeToAir++;
        if (c.library && c.library.length) linked++;
        if (c.library && c.library.some((x) => x.playable)) playable++;
      }
  }
  return { competitions: all.length, countries, channels, freeToAir, linked, playable };
}
