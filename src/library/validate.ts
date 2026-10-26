/**
 * Validation, polite by design:
 *  - reachability: one small ranged GET per URL (first 64 KB), 8 s timeout, at most
 *    `perHost` concurrent requests per host with a pause between them, `concurrency` overall;
 *  - playability (optional, capped): ffprobe on a prioritised sample (football, UK, English
 *    news, Arabic sports first). Only an ffprobe that finds media counts as "playable".
 * Results merge into catalogs/source-status.json; earlier results are kept.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { InventoryRecord } from './inventory.ts';
import type { StatusDb, StatusRecord } from './catalogs.ts';
import { runProbes, type ProbeDb } from '../builder/probe.ts';
import { USER_AGENT } from '../builder/fetch.ts';

export interface ValidateOptions {
  limit?: number;
  concurrency?: number;
  perHost?: number;
  hostDelayMs?: number;
  timeoutMs?: number;
  /** Re-check entries checked within this many hours only if `force`. */
  maxAgeHours?: number;
  force?: boolean;
  playable?: number;
  log?: (m: string) => void;
}

export interface Target {
  id: string;
  url: string;
  priority: number;
}

/** Football first, then UK, English news, sports, English/Hindi/Bengali, everything else. Pure. */
export function priorityOf(r: InventoryRecord): number {
  const m = r.meta;
  if (m.football || m.sports.indexOf('football') >= 0) return 0;
  if (m.country === 'UK') return 1;
  if (m.categories.indexOf('news') >= 0 && m.languages.indexOf('eng') >= 0) return 2;
  if (m.sports.length || m.categories.indexOf('sports') >= 0) return 3;
  if (m.languages.some((l) => l === 'ben' || l === 'hin' || l === 'eng')) return 4;
  return 5;
}

/** One target per unique stream the TV could attempt (imported or duplicate reference). Pure. */
export function targetsFrom(records: InventoryRecord[]): Target[] {
  const byId = new Map<string, Target>();
  for (const r of records) {
    if (!r.url || !r.streamId || (r.status !== 'imported' && r.status !== 'duplicate_reference')) continue;
    const p = priorityOf(r);
    const prev = byId.get(r.streamId);
    if (!prev || p < prev.priority) byId.set(r.streamId, { id: r.streamId, url: r.url, priority: p });
  }
  return Array.from(byId.values());
}

/** Interprets the first bytes of a response. Pure. */
export function contentKind(contentType: string, head: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(head.slice(0, 512)).trimStart();
  if (text.indexOf('#EXTM3U') === 0) return 'hls-playlist';
  if (head[0] === 0x47 && (head.length < 189 || head[188] === 0x47)) return 'mpeg-ts';
  if (/^<\?xml|<MPD/i.test(text)) return 'xml';
  if (/^<!doctype html|^<html/i.test(text) || /text\/html/i.test(contentType)) return 'html';
  if (/video|audio|mpegurl|octet-stream|mp2t/i.test(contentType)) return 'media';
  return contentType ? contentType.split(';')[0]! : 'unknown';
}

async function check(url: string, timeoutMs: number): Promise<StatusRecord> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const checkedAt = new Date().toISOString();
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Range: 'bytes=0-65535' }, signal: ctrl.signal, redirect: 'follow' });
    let head = new Uint8Array(0);
    if (res.body) {
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (total < 4096) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        chunks.push(value);
        total += value.length;
      }
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      head = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        head.set(c, o);
        o += c.length;
      }
    }
    const kind = contentKind(res.headers.get('content-type') || '', head);
    const reachable = res.ok && kind !== 'html';
    return { checkedAt, reachable, httpStatus: res.status, contentKind: kind, error: res.ok ? (kind === 'html' ? 'web page, not a stream' : undefined) : `HTTP ${res.status}` };
  } catch (err) {
    const e = err as Error & { cause?: { code?: string } };
    return { checkedAt, reachable: false, error: e.name === 'AbortError' ? 'timeout' : e.cause && e.cause.code ? e.cause.code : e.message.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return m ? m[1]!.toLowerCase() : url;
}

export async function validate(dir: string, entries: Target[], opts: ValidateOptions = {}): Promise<{ checked: number; reachable: number; playableChecked: number; playable: number }> {
  const log = opts.log || (() => undefined);
  const statusPath = join(dir, 'catalogs/source-status.json');
  const status: StatusDb = existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, 'utf8')) : {};
  const maxAge = (opts.maxAgeHours === undefined ? 24 : opts.maxAgeHours) * 3600000;
  const now = Date.now();
  const due = entries
    .filter((e) => opts.force || !status[e.id] || now - Date.parse(status[e.id]!.checkedAt) > maxAge)
    .sort((a, b) => a.priority - b.priority);
  const targets = opts.limit ? due.slice(0, opts.limit) : due;
  log(`reachability: ${targets.length} URLs to check (${entries.length - due.length} skipped as recently checked or not playable)`);

  const concurrency = opts.concurrency || 12;
  const perHost = opts.perHost || 2;
  const hostDelay = opts.hostDelayMs === undefined ? 300 : opts.hostDelayMs;
  const timeoutMs = opts.timeoutMs || 8000;
  const active = new Map<string, number>();
  const lastStart = new Map<string, number>();
  let next = 0;
  let done = 0;
  let reachable = 0;
  const queue = targets.slice();

  const take = (): Target | null => {
    for (let i = next; i < queue.length; i++) {
      const e = queue[i]!;
      const h = hostOf(e.url);
      if ((active.get(h) || 0) >= perHost) continue;
      if (Date.now() - (lastStart.get(h) || 0) < hostDelay) continue;
      queue.splice(i, 1);
      active.set(h, (active.get(h) || 0) + 1);
      lastStart.set(h, Date.now());
      return e;
    }
    return null;
  };

  const worker = async () => {
    while (queue.length) {
      const e = take();
      if (!e) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      const h = hostOf(e.url);
      const r = await check(e.url, timeoutMs);
      active.set(h, (active.get(h) || 1) - 1);
      const prev = status[e.id];
      status[e.id] = { ...(prev || {}), ...r };
      if (r.reachable) reachable++;
      done++;
      if (done % 250 === 0) {
        log(`reachability: ${done}/${targets.length} (${reachable} reachable)`);
        writeFileSync(statusPath, JSON.stringify(status));
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
  writeFileSync(statusPath, JSON.stringify(status));

  let playableChecked = 0;
  let playable = 0;
  if (opts.playable && opts.playable > 0) {
    const cands = entries
      .filter((e) => status[e.id] && status[e.id]!.reachable && !status[e.id]!.playableCheckedAt)
      .sort((a, b) => a.priority - b.priority)
      .slice(0, opts.playable);
    log(`playability: ffprobe on ${cands.length} reachable streams`);
    const db: ProbeDb = {};
    await runProbes(cands.map((e) => ({ id: e.id, url: e.url })), db, { perRun: cands.length, timeoutMs: 12000, concurrency: 4, maxAgeDays: 14 }, log);
    for (const e of cands) {
      const r = db[e.id];
      if (!r) continue;
      playableChecked++;
      const s = status[e.id]!;
      s.playableCheckedAt = r.at;
      s.playable = r.ok;
      if (r.width) s.width = r.width;
      if (r.height) s.height = r.height;
      if (r.ok) playable++;
      else s.error = r.error;
    }
    writeFileSync(statusPath, JSON.stringify(status));
  }
  return { checked: done, reachable, playableChecked, playable };
}
