// Shared helpers for the build/release scripts (plain Node, no dependencies).
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const isWin = process.platform === 'win32';

export function readJSON(path) {
  return JSON.parse(readFileSync(resolve(ROOT, path), 'utf8'));
}

export function appConfig() {
  const cfg = readJSON('fbtv.config.json');
  const pkg = readJSON('package.json');
  return { ...cfg, version: pkg.version };
}

export function ipkName(appId, version) {
  return `${appId}_${version}_all.ipk`;
}

/** Runs a command with inherited stdio; throws on failure. */
export function run(cmd, args, opts = {}) {
  let r;
  if (isWin) {
    // .cmd shims need a shell on Windows: build one command line with quoted arguments.
    const q = (a) => (/[\s&()^"<>|]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);
    r = spawnSync([cmd, ...args].map(q).join(' '), { stdio: 'inherit', cwd: ROOT, shell: true, ...opts });
  } else {
    r = spawnSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts });
  }
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with exit code ${r.status}`);
}

/** Runs a command and returns trimmed stdout. */
export function out(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim();
}

/**
 * Locates an LG CLI command (ares-*). Order: $ARES_CLI_DIR, PATH, the portable Node
 * install used on this PC (C:\Users\<you>\tools\node).
 */
export function ares(command) {
  const exe = isWin ? `${command}.cmd` : command;
  const dirs = [];
  if (process.env.ARES_CLI_DIR) dirs.push(process.env.ARES_CLI_DIR);
  for (const p of (process.env.PATH || '').split(isWin ? ';' : ':')) if (p) dirs.push(p);
  if (isWin && process.env.USERPROFILE) dirs.push(join(process.env.USERPROFILE, 'tools', 'node'));
  for (const d of dirs) {
    const candidate = join(d, exe);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `${command} not found. Install the LG webOS CLI with "npm install -g @webos-tools/cli" ` +
      'or set ARES_CLI_DIR to the folder that contains it.',
  );
}

export function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}
