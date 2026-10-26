/**
 * Collection: refresh Git snapshots (fetch only — nothing from a repository is executed),
 * copy 'copy' files byte-for-byte into repositories/<repo>/, download remote 'copy' files,
 * and record EVERY rule-matched file — copied or referenced — in manifest.json with its
 * origin, retrieval time, hash (when stored), permission, handling and reason. Files that are
 * not source data (code, images, build config) are counted per extension in the audit.
 * Re-running is safe: unchanged files keep their original retrieval time.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fetchText } from '../builder/fetch.ts';
import { DISCOVERED, REPOS, type Category, type EntryPolicy, type Handling, type Permission, type RepoDef } from './repos.ts';

export interface ManifestFile {
  /** Path relative to the data directory (for referenced files: where it would live). */
  path: string;
  repo: string;
  /** Path inside the source repository, or the remote URL. */
  origin: string;
  originUrl: string;
  handling: Handling;
  policy: EntryPolicy;
  stored: boolean;
  retrievedAt: string;
  sha256?: string;
  bytes?: number;
  licence: string;
  permission: Permission;
  category: Category;
  reason?: string;
  commit?: string;
  status: 'downloaded' | 'referenced' | 'failed';
  error?: string;
}

export interface RepoAudit {
  id: string;
  name: string;
  url: string;
  licence: string;
  summary: string;
  status: 'ok' | 'error';
  error?: string;
  commit?: string;
  commitDate?: string;
  filesInRepo: number;
  matched: number;
  stored: number;
  referenced: number;
  /** Files that are not source data, by extension. */
  notSourceData: Record<string, number>;
  references: { url: string; reason: string }[];
}

export interface Manifest {
  schema: 2;
  updatedAt: string;
  files: ManifestFile[];
  repositories: RepoAudit[];
}

const git = (args: string[], cwd?: string) =>
  execFileSync('git', ['-c', 'core.quotePath=false', '-c', 'core.longpaths=true', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  });

export const gitShow = (snapshot: string, path: string): Buffer =>
  execFileSync('git', ['-c', 'core.longpaths=true', 'show', `HEAD:${path}`], { cwd: snapshot, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 });

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

export function loadManifest(dir: string): Manifest {
  const p = join(dir, 'manifest.json');
  if (existsSync(p)) {
    try {
      const m = JSON.parse(readFileSync(p, 'utf8')) as Manifest;
      if (m.schema === 2) return m;
    } catch {
      /* rebuilt below */
    }
  }
  return { schema: 2, updatedAt: '', files: [], repositories: [] };
}

export function snapshotDir(dir: string, repoId: string): string {
  return join(dir, 'cache', 'git', repoId);
}

function refreshSnapshot(dir: string, repo: RepoDef, log: (m: string) => void): string {
  const target = snapshotDir(dir, repo.id);
  if (!existsSync(target)) {
    log(`${repo.id}: cloning ${repo.url}`);
    git(['clone', '--quiet', '--depth', '1', '--filter=blob:none', '--no-checkout', `${repo.url}.git`, target]);
  } else {
    log(`${repo.id}: fetching updates`);
    git(['fetch', '--quiet', '--depth', '1', 'origin', 'HEAD'], target);
    git(['update-ref', 'HEAD', 'FETCH_HEAD'], target);
  }
  return target;
}

/** Writes a file, keeping a timestamped backup if a different file is already there. */
function writeKeepingBackup(abs: string, body: Buffer): void {
  mkdirSync(dirname(abs), { recursive: true });
  if (existsSync(abs)) {
    const old = readFileSync(abs);
    if (sha(old) === sha(body)) return;
    // Only library-managed originals live here, but never lose one silently.
    renameSync(abs, `${abs}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`);
  }
  writeFileSync(abs, body);
}

/** `only`: refresh just these repositories and keep every other repository's manifest entries as they were. */
export async function collect(dir: string, log: (m: string) => void, opts: { offline?: boolean; only?: string[] } = {}): Promise<Manifest> {
  const prev = loadManifest(dir);
  const byPath = new Map<string, ManifestFile>();
  for (const f of prev.files) byPath.set(f.path, f);
  const now = new Date().toISOString();
  const audits: RepoAudit[] = [];
  const files: ManifestFile[] = [];

  const record = (f: Omit<ManifestFile, 'retrievedAt'>, body: Buffer | null) => {
    const old = byPath.get(f.path);
    const entry: ManifestFile = { ...f, retrievedAt: now };
    if (body) {
      entry.sha256 = sha(body);
      entry.bytes = body.length;
      if (old && old.sha256 === entry.sha256) entry.retrievedAt = old.retrievedAt;
      if (f.stored) writeKeepingBackup(join(dir, f.path), body);
    }
    files.push(entry);
  };

  for (const repo of REPOS.concat(DISCOVERED)) {
    if (opts.only && opts.only.indexOf(repo.id) < 0) {
      files.push(...prev.files.filter((f) => f.repo === repo.id));
      const old = (prev.repositories || []).filter((a) => a.id === repo.id)[0];
      if (old) audits.push(old);
      continue;
    }
    const audit: RepoAudit = {
      id: repo.id,
      name: repo.name,
      url: repo.url,
      licence: repo.licence,
      summary: repo.summary,
      status: 'ok',
      filesInRepo: 0,
      matched: 0,
      stored: 0,
      referenced: 0,
      notSourceData: {},
      references: repo.references || [],
    };
    audits.push(audit);
    try {
      if (repo.rules.length) {
        const snap = opts.offline ? snapshotDir(dir, repo.id) : refreshSnapshot(dir, repo, log);
        audit.commit = git(['rev-parse', '--short', 'HEAD'], snap).trim();
        audit.commitDate = git(['log', '-1', '--format=%cI', 'HEAD'], snap).trim();
        const list = git(['ls-tree', '-r', '--name-only', 'HEAD'], snap).split('\n').filter(Boolean);
        audit.filesInRepo = list.length;
        for (const path of list) {
          const rule = repo.rules.filter((r) => r.match.test(path))[0];
          if (!rule) {
            const ext = extname(path).toLowerCase() || '(none)';
            audit.notSourceData[ext] = (audit.notSourceData[ext] || 0) + 1;
            continue;
          }
          audit.matched++;
          const body = gitShow(snap, path);
          const stored = rule.handling === 'copy';
          record(
            {
              path: `repositories/${repo.id}/${path}`,
              repo: repo.id,
              origin: path,
              originUrl: `${repo.url}/blob/${audit.commit}/${encodeURI(path)}`,
              handling: rule.handling,
              policy: rule.policy,
              stored,
              licence: repo.licence,
              permission: rule.permission,
              category: rule.category,
              reason: rule.reason,
              commit: audit.commit,
              status: stored ? 'downloaded' : 'referenced',
            },
            body,
          );
          if (stored) audit.stored++;
          else audit.referenced++;
        }
      }
      for (const rf of repo.remote || []) {
        audit.matched++;
        const path = `repositories/${repo.id}/${rf.path}`;
        const base = {
          path,
          repo: repo.id,
          origin: rf.url,
          originUrl: rf.url,
          handling: rf.handling,
          policy: rf.policy,
          stored: rf.handling === 'copy',
          licence: repo.licence,
          permission: rf.permission,
          category: rf.category,
          reason: rf.reason,
        };
        if (rf.handling === 'reference') {
          // Not downloaded here; the inventory step reads it without storing it.
          record({ ...base, status: 'referenced' }, null);
          audit.referenced++;
          continue;
        }
        if (opts.offline) {
          const old = byPath.get(path);
          if (old) files.push(old);
          continue;
        }
        try {
          const r = await fetchText(rf.url, { timeoutMs: 90000, maxBytes: 80 * 1024 * 1024, cacheDir: join(dir, 'cache', 'http') });
          record({ ...base, status: 'downloaded' }, Buffer.from(r.body, 'utf8'));
          audit.stored++;
          log(`${repo.id}: ${rf.path} (${r.body.length.toLocaleString()} chars${r.fromCache ? ', unchanged' : ''})`);
        } catch (err) {
          const old = byPath.get(path);
          const message = (err as Error).message;
          // Keep the last good copy (and its reference) for a later retry.
          files.push({ ...(old || { ...base, retrievedAt: now }), status: 'failed', error: message, stored: !!old && old.stored } as ManifestFile);
          log(`${repo.id}: FAILED ${rf.url}: ${message}`);
        }
      }
      log(`${repo.id}: ${audit.stored} stored, ${audit.referenced} referenced, ${Object.values(audit.notSourceData).reduce((a, b) => a + b, 0)} not source data`);
    } catch (err) {
      audit.status = 'error';
      audit.error = (err as Error).message.split('\n')[0];
      log(`${repo.id}: ERROR ${audit.error}`);
    }
  }

  const manifest: Manifest = {
    schema: 2,
    updatedAt: now,
    files: files.sort((a, b) => (a.path < b.path ? -1 : 1)),
    repositories: audits,
  };
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return manifest;
}
