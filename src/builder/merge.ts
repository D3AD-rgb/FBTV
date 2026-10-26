/**
 * Merges channels from all sources, removes duplicate stream URLs across sources, and
 * applies manual overrides and the Kids allowlist. Pure.
 */
import type { CatalogueChannel } from '../shared/model.ts';
import { streamFingerprint } from '../shared/normalize.ts';

export interface ChannelOverride {
  name?: string;
  altNames?: string[];
  country?: string;
  languages?: string[];
  categories?: string[];
  sports?: string[];
  epgId?: string;
  logo?: string;
  /** Remove the channel from the catalogue. */
  hidden?: boolean;
}

export interface Overrides {
  channels?: Record<string, ChannelOverride>;
  /** Channel ids approved for the Kids area in addition to kids/animation categories. */
  kidsAllowlist?: string[];
  /** Channel ids never shown in the Kids area, even if their category says so. */
  kidsBlocklist?: string[];
}

export interface MergeResult {
  channels: CatalogueChannel[];
  duplicates: number;
  hidden: number;
}

/** Earlier sources win when the same stream URL appears twice (list iptv-org first). */
export function mergeChannels(lists: CatalogueChannel[][], overrides: Overrides = {}): MergeResult {
  const byId = new Map<string, CatalogueChannel>();
  const streamOwner = new Map<string, string>();
  let duplicates = 0;

  for (const list of lists) {
    for (const incoming of list) {
      const existing = byId.get(incoming.id);
      const target: CatalogueChannel = existing || { ...incoming, streams: [], sources: [] };
      if (!existing) byId.set(incoming.id, target);
      for (const s of incoming.streams) {
        const fp = s.id || streamFingerprint(s.url);
        if (streamOwner.has(fp)) {
          duplicates++;
          continue;
        }
        streamOwner.set(fp, target.id);
        target.streams.push(s);
      }
      for (const src of incoming.sources) if (target.sources.indexOf(src) < 0) target.sources.push(src);
      if (existing) {
        // Fill gaps only; never overwrite metadata from an earlier (more trusted) source.
        if (!target.logo && incoming.logo) target.logo = incoming.logo;
        if (!target.country && incoming.country) target.country = incoming.country;
        if (!target.languages && incoming.languages) target.languages = incoming.languages;
        if (!target.categories && incoming.categories) target.categories = incoming.categories;
        if (!target.epgId && incoming.epgId) target.epgId = incoming.epgId;
      }
    }
  }

  let hidden = 0;
  const allow = new Set(overrides.kidsAllowlist || []);
  const deny = new Set(overrides.kidsBlocklist || []);
  const out: CatalogueChannel[] = [];
  byId.forEach((ch) => {
    if (!ch.streams.length) return;
    const o = overrides.channels ? overrides.channels[ch.id] : undefined;
    if (o) {
      if (o.hidden) {
        hidden++;
        return;
      }
      if (o.name) ch.name = o.name;
      if (o.altNames) ch.altNames = o.altNames;
      if (o.country) ch.country = o.country;
      if (o.languages) ch.languages = o.languages;
      if (o.categories) ch.categories = o.categories;
      if (o.epgId) ch.epgId = o.epgId;
      if (o.logo) ch.logo = o.logo;
      if (o.sports) {
        ch.sports = o.sports;
        ch.sportsBy = 'override';
      }
    }
    if (deny.has(ch.id)) {
      delete ch.kids;
      delete ch.kidsBy;
    } else if (allow.has(ch.id)) {
      ch.kids = true;
      ch.kidsBy = 'allowlist';
    }
    out.push(ch);
  });
  out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { channels: out, duplicates, hidden };
}
