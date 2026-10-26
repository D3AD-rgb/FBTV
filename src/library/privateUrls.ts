/**
 * Private stream addresses. Entries from your own sources (provider profiles) can carry your
 * login in the URL, and local playlist files have Windows paths; neither may appear in the TV
 * export or the packaged app. They are exported as "@play/<token>" and the library server on
 * your PC resolves a token to the real address only when the TV asks to play it (a redirect).
 * The token map lives in generated/private/ on the PC and is never exported.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { trackOutput } from './outputs.ts';

const MAP_FILE = 'generated/private/play-tokens.json';
const tokens = new Map<string, string>();

export function isPrivateSource(repo: string): boolean {
  return repo.indexOf('profile:') === 0;
}

/** "@play/<token>" for a private URL; the mapping is kept for the library server. */
export function privateRef(url: string): string {
  const t = createHash('sha256').update(url).digest('hex').slice(0, 24);
  tokens.set(t, url);
  return `@play/${t}`;
}

export function resetPrivateRefs(): void {
  tokens.clear();
}

export function savePrivateRefs(dir: string): number {
  const p = join(dir, MAP_FILE);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, JSON.stringify(Object.fromEntries(tokens)));
  trackOutput(p);
  return tokens.size;
}

export function loadPrivateRefs(dir: string): Map<string, string> {
  const p = join(dir, MAP_FILE);
  if (!existsSync(p)) return new Map();
  try {
    return new Map(Object.entries(JSON.parse(readFileSync(p, 'utf8')) as Record<string, string>));
  } catch {
    return new Map();
  }
}
