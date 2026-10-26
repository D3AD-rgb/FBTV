/**
 * Normalised catalogue model, shared by the catalogue builder (writes it) and the TV app
 * (reads it). Raw source records are never stored here; only normalised fields plus the
 * provenance needed to trace a value back to its source.
 */

/** Advertised quality comes from the source; verified comes from our own probe. */
export interface StreamProbe {
  width: number;
  height: number;
  videoCodec?: string;
  audioCodecs?: string[];
  /** ISO timestamp of the probe. */
  at: string;
}

export type StreamStatus = 'unknown' | 'online' | 'offline';

export interface CatalogueStream {
  /** Stable id: fingerprint of the URL. */
  id: string;
  url: string;
  /** iptv-org feed id (e.g. "SD", "London") or a source-specific variant label. */
  feed?: string;
  feedName?: string;
  /** Advertised by the source, e.g. "1080p". Not verified. */
  quality?: string;
  /** Source labels, e.g. "Geo-blocked", "Not 24/7". */
  labels?: string[];
  /** Header requirements (stream is excluded from playback when set). */
  needsHeaders?: boolean;
  languages?: string[];
  probe?: StreamProbe;
  status?: StreamStatus;
  /** ISO timestamp of the last availability check. */
  checkedAt?: string;
  source: string;
}

export interface CatalogueChannel {
  /** Stable internal id: the iptv-org channel id when known, else "src:<source>:<slug>". */
  id: string;
  name: string;
  altNames?: string[];
  /** Country code as used by iptv-org (note: "UK", not "GB"). */
  country?: string;
  /** ISO 639-3 language codes (from feeds / source metadata). */
  languages?: string[];
  /** iptv-org category ids (news, sports, kids, …). */
  categories?: string[];
  /** Sport tags (football, cricket, …) — from name keywords or overrides; see `sportsBy`. */
  sports?: string[];
  sportsBy?: 'override' | 'name';
  logo?: string;
  network?: string;
  /** Guide id used to match XMLTV programmes (iptv-org id or tvg-id). */
  epgId?: string;
  /** True when the channel may appear in the Kids area (category or allowlist, never title words). */
  kids?: boolean;
  kidsBy?: 'category' | 'allowlist';
  streams: CatalogueStream[];
  /** Source ids that contributed to this channel. */
  sources: string[];
}

export interface CountryInfo {
  code: string;
  name: string;
  flag?: string;
  languages?: string[];
  region?: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
}

export interface CatalogueManifestShard {
  name: string;
  file: string;
  sha256: string;
  bytes: number;
}

export interface CatalogueManifest {
  schema: 1;
  generatedAt: string;
  builderVersion: string;
  shards: CatalogueManifestShard[];
  sources: SourceReport[];
  counts: Record<string, number>;
}

export interface SourceReport {
  id: string;
  name: string;
  ok: boolean;
  /** ISO timestamp of the last successful fetch. */
  lastSuccess?: string;
  error?: string;
  entries?: number;
}

export interface Catalogue {
  generatedAt: string;
  channels: CatalogueChannel[];
  countries: CountryInfo[];
  languages: LanguageInfo[];
  categories: { id: string; name: string }[];
}
