/**
 * Credential storage for provider profiles.
 *
 * Windows: values are encrypted with DPAPI (CurrentUser scope) through PowerShell, so only
 * this Windows account on this PC can decrypt them. The plaintext is passed over stdin,
 * never on a command line. Elsewhere: a JSON file with 0600 permissions, with a warning.
 *
 * Secrets never appear in the registry, catalogs, generated playlists, logs or reports.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Credentials {
  username: string;
  password: string;
}

type Store = Record<string, { username: string; password: string; scheme: 'dpapi' | 'plain'; updatedAt: string }>;

const isWin = process.platform === 'win32';

function storePath(dataDir: string): string {
  return join(dataDir, 'provider-profiles', isWin ? 'secrets.dpapi.json' : 'secrets.local.json');
}

function ps(script: string, input: string): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

const PROTECT =
  "Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd(); " +
  "$b=[Text.Encoding]::UTF8.GetBytes($t); " +
  "[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,'CurrentUser'))";
const UNPROTECT =
  "Add-Type -AssemblyName System.Security; $t=[Console]::In.ReadToEnd().Trim(); " +
  "$b=[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($t),$null,'CurrentUser'); " +
  "[Text.Encoding]::UTF8.GetString($b)";

function load(dataDir: string): Store {
  const p = storePath(dataDir);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as Store;
  } catch {
    return {};
  }
}

function save(dataDir: string, store: Store): void {
  const p = storePath(dataDir);
  writeFileSync(p, JSON.stringify(store, null, 2));
  if (!isWin) chmodSync(p, 0o600);
}

export function setCredentials(dataDir: string, profileId: string, c: Credentials): 'dpapi' | 'plain' {
  const store = load(dataDir);
  if (isWin) {
    store[profileId] = { username: ps(PROTECT, c.username), password: ps(PROTECT, c.password), scheme: 'dpapi', updatedAt: new Date().toISOString() };
  } else {
    console.warn('No OS secret store is used on this platform: credentials are saved in a file readable only by you (mode 600).');
    store[profileId] = { username: c.username, password: c.password, scheme: 'plain', updatedAt: new Date().toISOString() };
  }
  save(dataDir, store);
  return store[profileId]!.scheme;
}

export function getCredentials(dataDir: string, profileId: string): Credentials | null {
  const entry = load(dataDir)[profileId];
  if (!entry) return null;
  if (entry.scheme === 'dpapi') return { username: ps(UNPROTECT, entry.username), password: ps(UNPROTECT, entry.password) };
  return { username: entry.username, password: entry.password };
}

export function hasCredentials(dataDir: string, profileId: string): boolean {
  return !!load(dataDir)[profileId];
}

export function removeCredentials(dataDir: string, profileId: string): boolean {
  const store = load(dataDir);
  if (!store[profileId]) return false;
  delete store[profileId];
  save(dataDir, store);
  return true;
}

/** Replaces any occurrence of the credentials in a message (URLs embed them). */
export function maskSecrets(text: string, c: Credentials | null): string {
  if (!c) return text;
  let out = text;
  for (const v of [c.password, c.username, encodeURIComponent(c.password), encodeURIComponent(c.username)]) {
    if (v && v.length >= 2) out = out.split(v).join('***');
  }
  return out;
}
