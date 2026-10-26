/**
 * Provider profiles: your own M3U playlists (file or URL) and Xtream-compatible accounts.
 * profiles.local.json holds non-secret settings; credentials live in the secret store
 * (secrets.ts). profiles.example.json documents the format and is safe to share.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSourceUrl } from '../shared/url.ts';

export type ContentType = 'live' | 'vod-movies' | 'vod-series' | 'mixed';

export interface M3UProfile {
  id: string;
  type: 'm3u';
  name: string;
  /** Exactly one of url / file. */
  url?: string;
  file?: string;
  contentType: ContentType;
  /** Language scope you assert for this playlist (ISO 639-3), used when entries carry none. */
  languages?: string[];
  enabled: boolean;
}

export interface XtreamProfile {
  id: string;
  type: 'xtream';
  name: string;
  /** Base URL, e.g. https://provider.example:8080 (no credentials here). */
  server: string;
  /** Preferred live output: "m3u8" or "ts" (only if the account allows it). */
  liveFormat?: 'm3u8' | 'ts';
  /**
   * Your own mapping from provider category names to languages, e.g. {"EN |": "eng",
   * "HINDI": "hin", "BANGLA": "ben"}. Matches are case-insensitive substrings. Items in
   * unmapped categories go to the language review list, never guessed.
   */
  categoryLanguages?: Record<string, string>;
  /** How many series to fetch episode lists for per refresh (rate-limited). */
  episodesPerRefresh?: number;
  enabled: boolean;
}

export type Profile = M3UProfile | XtreamProfile;

export interface ProfilesFile {
  $comment?: string;
  profiles: Profile[];
}

export const EXAMPLE: ProfilesFile = {
  $comment:
    'Copy entries into profiles.local.json and edit them. Never put usernames or passwords here: ' +
    'store them with `npm run library:secret -- set <profile-id>` (encrypted with Windows DPAPI).',
  profiles: [
    {
      id: 'my-playlist',
      type: 'm3u',
      name: 'My M3U playlist',
      url: 'https://example.invalid/my-playlist.m3u',
      contentType: 'live',
      languages: ['eng'],
      enabled: false,
    },
    {
      id: 'my-local-vod',
      type: 'm3u',
      name: 'My VOD playlist (local file)',
      file: 'C:/path/to/vod.m3u',
      contentType: 'vod-movies',
      languages: ['eng'],
      enabled: false,
    },
    {
      id: 'my-xtream',
      type: 'xtream',
      name: 'My Xtream provider',
      server: 'https://provider.example.invalid:8080',
      liveFormat: 'm3u8',
      categoryLanguages: { 'EN |': 'eng', ENGLISH: 'eng', HINDI: 'hin', BANGLA: 'ben', BENGALI: 'ben' },
      episodesPerRefresh: 50,
      enabled: false,
    },
  ],
};

export function profilesPaths(dataDir: string) {
  const base = join(dataDir, 'provider-profiles');
  return { example: join(base, 'profiles.example.json'), local: join(base, 'profiles.local.json') };
}

/** Writes the example (always) and an empty local file (only if missing — never overwritten). */
export function ensureProfiles(dataDir: string): void {
  const p = profilesPaths(dataDir);
  writeFileSync(p.example, JSON.stringify(EXAMPLE, null, 2) + '\n');
  if (!existsSync(p.local)) {
    const empty: ProfilesFile = {
      $comment: 'Your provider profiles. See profiles.example.json. Credentials are NOT stored in this file.',
      profiles: [],
    };
    writeFileSync(p.local, JSON.stringify(empty, null, 2) + '\n');
  }
}

export interface ProfileProblem {
  id: string;
  problem: string;
}

export function loadProfiles(dataDir: string): { profiles: Profile[]; problems: ProfileProblem[] } {
  const p = profilesPaths(dataDir);
  if (!existsSync(p.local)) return { profiles: [], problems: [] };
  let parsed: ProfilesFile;
  try {
    parsed = JSON.parse(readFileSync(p.local, 'utf8')) as ProfilesFile;
  } catch (err) {
    return { profiles: [], problems: [{ id: '(file)', problem: `profiles.local.json is not valid JSON: ${(err as Error).message}` }] };
  }
  const profiles: Profile[] = [];
  const problems: ProfileProblem[] = [];
  const seen = new Set<string>();
  for (const raw of parsed.profiles || []) {
    const id = String((raw as Profile).id || '');
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(id)) {
      problems.push({ id: id || '(missing id)', problem: 'id must be 2–41 lowercase letters, digits or dashes' });
      continue;
    }
    if (seen.has(id)) {
      problems.push({ id, problem: 'duplicate id' });
      continue;
    }
    seen.add(id);
    const prof = raw as Profile;
    if (/(username|password|passwd|pwd)/i.test(JSON.stringify(raw).replace(/"categoryLanguages":\{[^}]*\}/, ''))) {
      problems.push({ id, problem: 'contains a username/password field — remove it and use `npm run library:secret -- set ' + id + '`' });
      continue;
    }
    if (prof.type === 'm3u') {
      if (!!prof.url === !!prof.file) {
        problems.push({ id, problem: 'set exactly one of "url" or "file"' });
        continue;
      }
      if (prof.url) {
        const c = checkSourceUrl(prof.url, { allowHttp: true, allowPrivate: true });
        if (!c.ok) {
          problems.push({ id, problem: c.reason || 'invalid url' });
          continue;
        }
      }
    } else if (prof.type === 'xtream') {
      const c = checkSourceUrl(prof.server, { allowHttp: true, allowPrivate: true });
      if (!c.ok) {
        problems.push({ id, problem: c.reason || 'invalid server' });
        continue;
      }
    } else {
      problems.push({ id, problem: `unknown type "${(prof as { type: string }).type}"` });
      continue;
    }
    profiles.push(prof);
  }
  return { profiles, problems };
}
