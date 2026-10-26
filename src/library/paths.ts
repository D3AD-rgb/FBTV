/**
 * Local source library location. Lives OUTSIDE the Git repository so personal playlists,
 * provider profiles, secrets and downloaded catalogues are never committed.
 *
 *   IPTV_DATA_DIR=<path>   overrides the default sibling folder ../FBTV-local-data
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const REPO_ROOT = resolve(import.meta.dirname, '..', '..');

export function dataDir(): string {
  const fromEnv = process.env.IPTV_DATA_DIR;
  return resolve(fromEnv && fromEnv.trim() ? fromEnv.trim() : join(REPO_ROOT, '..', 'FBTV-local-data'));
}

/** True when `dir` (or an ancestor) is inside a Git work tree. */
export function insideGitWorktree(dir: string): boolean {
  try {
    const out = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
    });
    return out.trim() === 'true';
  } catch {
    return false;
  }
}

export const LAYOUT = [
  'repositories',
  'playlists/live-tv',
  'playlists/sports',
  'playlists/football',
  'playlists/news',
  'playlists/movies-vod',
  'playlists/series-vod',
  'playlists/combined',
  'playlists/source-playlists',
  'playlists/custom',
  'playlists/my-playlist',
  'playlists/4k',
  'media/movies',
  'media/series',
  'media/other',
  'settings',
  'manifests',
  'reports',
  'catalogs',
  'provider-profiles',
  'generated',
  'logs',
  'cache/git',
  'cache/http',
];

/** Creates the folder layout; refuses a data dir inside a Git work tree. */
export function ensureDataDir(dir = dataDir()): string {
  mkdirSync(dir, { recursive: true });
  if (insideGitWorktree(dir)) {
    throw new Error(
      `Refusing to use ${dir}: it is inside a Git work tree, so personal sources could be committed. ` +
        'Set IPTV_DATA_DIR to a folder outside any repository.',
    );
  }
  for (const sub of LAYOUT) mkdirSync(join(dir, sub), { recursive: true });
  return dir;
}

export function rel(dir: string, abs: string): string {
  const r = abs.slice(dir.length).replace(/^[\\/]+/, '');
  return r.split('\\').join('/');
}

export function exists(p: string): boolean {
  return existsSync(p);
}
