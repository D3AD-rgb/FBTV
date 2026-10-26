/**
 * Generic M3U source → catalogue channels. Used for playlists you add yourself.
 * Entries whose tvg-id matches a known channel id (e.g. iptv-org "BBCNews.uk@SD") attach to
 * that channel; others get a synthetic id from source + canonical name + country, so two
 * regional feeds with different names stay separate.
 */
import type { CatalogueChannel, CatalogueStream } from '../shared/model.ts';
import type { M3UEntry } from '../shared/m3u.ts';
import { splitTitle } from '../shared/m3u.ts';
import {
  canonicalName,
  normalizeCountry,
  normalizeLanguages,
  slug,
  sportsFromName,
  streamFingerprint,
} from '../shared/normalize.ts';

export interface M3USourceConfig {
  id: string;
  /** Applied when an entry has no country/language of its own. */
  defaults?: { country?: string; languages?: string[]; categories?: string[] };
}

export interface M3UBuildResult {
  channels: CatalogueChannel[];
  dropped: Record<string, number>;
}

const GROUP_TO_CATEGORY: [RegExp, string][] = [
  [/\bnews\b/i, 'news'],
  [/\bsports?\b/i, 'sports'],
  [/\b(kids|children|cartoons?)\b/i, 'kids'],
  [/\banimation\b/i, 'animation'],
  [/\b(movies?|films?|cinema)\b/i, 'movies'],
  [/\bseries\b/i, 'series'],
  [/\bdocumentar(y|ies)\b/i, 'documentary'],
  [/\bmusic\b/i, 'music'],
  [/\b(religio|islam|christian)/i, 'religious'],
];

/** group-title is a hint only; it maps to a category when it clearly names one. */
export function categoriesFromGroup(group: string | undefined): string[] {
  if (!group) return [];
  const out: string[] = [];
  for (const [re, cat] of GROUP_TO_CATEGORY) if (re.test(group) && out.indexOf(cat) < 0) out.push(cat);
  return out;
}

export function buildFromM3U(entries: M3UEntry[], cfg: M3USourceConfig, knownIds: Set<string>): M3UBuildResult {
  const dropped: Record<string, number> = {};
  const bump = (k: string) => {
    dropped[k] = (dropped[k] || 0) + 1;
  };
  const byId = new Map<string, CatalogueChannel>();
  const seenStreams = new Set<string>();

  for (const e of entries) {
    if (!/^https?:\/\//i.test(e.url)) {
      bump('unsupported-protocol');
      continue;
    }
    if (/\.mpd(\?|$)/i.test(e.url)) {
      bump('dash');
      continue;
    }
    if (e.userAgent || e.referrer) {
      bump('needs-headers');
      continue;
    }
    const fp = streamFingerprint(e.url);
    if (seenStreams.has(fp)) {
      bump('duplicate-url');
      continue;
    }
    seenStreams.add(fp);

    const title = splitTitle(e.title || e.attrs['tvg-name'] || '');
    if (!title.name) {
      bump('no-name');
      continue;
    }
    const tvgId = (e.attrs['tvg-id'] || '').trim();
    const [baseId, feedId] = tvgId.split('@') as [string, string | undefined];
    const country =
      normalizeCountry(e.attrs['tvg-country']) ||
      (baseId && /\.[a-z]{2}$/i.test(baseId) ? normalizeCountry(baseId.slice(-2)) : undefined) ||
      normalizeCountry(cfg.defaults && cfg.defaults.country);
    const languages = normalizeLanguages([e.attrs['tvg-language']]);
    const langs = languages.length ? languages : (cfg.defaults && cfg.defaults.languages) || [];
    const known = baseId && knownIds.has(baseId) ? baseId : '';
    const id = known || `src:${cfg.id}:${slug(canonicalName(title.name))}${country ? '.' + country.toLowerCase() : ''}`;

    const stream: CatalogueStream = { id: fp, url: e.url, source: cfg.id };
    if (feedId) stream.feed = feedId;
    if (title.quality) stream.quality = title.quality;
    if (title.labels.length) stream.labels = title.labels;
    if (langs.length) stream.languages = langs.slice();

    let ch = byId.get(id);
    if (!ch) {
      const categories = categoriesFromGroup(e.group);
      const cats = categories.length ? categories : (cfg.defaults && cfg.defaults.categories) || [];
      ch = { id, name: title.name, streams: [], sources: [cfg.id] };
      if (country) ch.country = country;
      if (langs.length) ch.languages = langs.slice();
      if (cats.length) ch.categories = cats.slice();
      const logo = e.attrs['tvg-logo'];
      if (logo && /^https:\/\//i.test(logo)) ch.logo = logo;
      if (tvgId) ch.epgId = known || tvgId;
      if (cats.indexOf('sports') >= 0) {
        const sports = sportsFromName(title.name);
        if (sports.length) {
          ch.sports = sports;
          ch.sportsBy = 'name';
        }
      }
      // Kids eligibility is never inferred from a playlist's group title (it is not trusted
      // metadata); such channels need the allowlist.
      byId.set(id, ch);
    }
    ch.streams.push(stream);
  }
  return { channels: Array.from(byId.values()), dropped };
}
