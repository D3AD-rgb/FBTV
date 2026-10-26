/**
 * Generated-output ownership. Every file the library builder writes is recorded; the list is
 * saved in manifests/generated-files.json. Cleanup only ever removes a file that
 *  - a previous run recorded as its own (in that manifest),
 *  - was not written by the current run, and
 *  - lies inside one of the builder's own output folders.
 * Original repository files, your playlists (playlists/my-playlist, playlists/custom-user),
 * media, provider profiles, settings and backups are never candidates. Files nobody recorded
 * (for example ones you put there yourself) are reported and left in place.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const MANIFEST = 'manifests/generated-files.json';

/** Folders the builder writes into (relative to the data directory). */
export const OWNED_ROOTS = ['playlists/', 'catalogs/', 'generated/'];
/** Never touched, even inside an owned root. */
export const NEVER = ['playlists/my-playlist/', 'playlists/custom-user/', 'generated/profiles/', 'catalogs/source-status.json', 'catalogs/inventory.jsonl'];

let current: Set<string> | null = null;
let base = '';

const toRel = (abs: string) => relative(base, abs).split('\\').join('/');

export function beginOutputs(dir: string): void {
  base = dir;
  current = new Set();
}

/** Records a file written by this run (absolute path). */
export function trackOutput(abs: string): void {
  if (current && base) current.add(toRel(abs));
}

/** Writes and records a generated file. */
export function writeOutput(abs: string, data: string): void {
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, data);
  trackOutput(abs);
}

export function isOwnedPath(rel: string): boolean {
  if (rel.indexOf('..') >= 0 || /^[a-z]:/i.test(rel) || rel.charAt(0) === '/') return false;
  if (NEVER.some((n) => rel === n || rel.indexOf(n) === 0)) return false;
  return OWNED_ROOTS.some((r) => rel.indexOf(r) === 0);
}

export interface CleanupPlan {
  /** Recorded by an earlier run, not written now, inside an owned folder: will be removed. */
  remove: string[];
  /** Recorded earlier but outside owned folders (never removed). */
  protected: string[];
}

/** Which earlier outputs are stale. Pure. */
export function planCleanup(previous: string[], written: Set<string>): CleanupPlan {
  const remove: string[] = [];
  const prot: string[] = [];
  for (const p of previous) {
    if (written.has(p)) continue;
    if (isOwnedPath(p)) remove.push(p);
    else prot.push(p);
  }
  return { remove: remove.sort(), protected: prot.sort() };
}

export function readOutputManifest(dir: string): string[] {
  const p = join(dir, MANIFEST);
  if (!existsSync(p)) return [];
  try {
    return (JSON.parse(readFileSync(p, 'utf8')) as { files: string[] }).files || [];
  } catch {
    return [];
  }
}

/**
 * Ends a build: removes stale owned outputs (unless dryRun) and saves the new manifest.
 * Returns the plan so callers can report it.
 */
export function finishOutputs(dir: string, log: (m: string) => void, opts: { dryRun?: boolean } = {}): CleanupPlan {
  const written = current || new Set<string>();
  const plan = planCleanup(readOutputManifest(dir), written);
  for (const rel of plan.remove) {
    const abs = join(dir, rel);
    if (opts.dryRun) continue;
    try {
      if (existsSync(abs)) unlinkSync(abs);
    } catch (err) {
      log(`cleanup: could not remove ${rel}: ${(err as Error).message}`);
    }
  }
  if (plan.remove.length) log(`cleanup: ${opts.dryRun ? 'would remove' : 'removed'} ${plan.remove.length} outdated generated file(s)`);
  writeCleanupReport(dir, plan, !!opts.dryRun);
  if (!opts.dryRun) {
    mkdirSync(join(dir, 'manifests'), { recursive: true });
    writeFileSync(join(dir, MANIFEST), JSON.stringify({ generatedAt: new Date().toISOString(), files: Array.from(written).sort() }, null, 1));
  }
  current = null;
  return plan;
}

export function writeCleanupReport(dir: string, plan: CleanupPlan, dryRun: boolean): void {
  mkdirSync(join(dir, 'reports'), { recursive: true });
  const lines = [
    `# Cleanup ${dryRun ? '(dry run: nothing deleted)' : ''}`.trim(),
    '',
    `Generated ${new Date().toISOString()}. Only files an earlier build recorded as its own, inside its output folders (${OWNED_ROOTS.join(', ')}), are removed.`,
    '',
    `## ${dryRun ? 'Would remove' : 'Removed'} (${plan.remove.length})`,
    '',
    ...plan.remove.map((p) => `- ${p}`),
    '',
    `## Recorded earlier, outside the output folders: kept (${plan.protected.length})`,
    '',
    ...plan.protected.map((p) => `- ${p}`),
    '',
  ];
  writeFileSync(join(dir, 'reports', dryRun ? 'cleanup-dry-run.md' : 'cleanup.md'), lines.join('\n'));
}
