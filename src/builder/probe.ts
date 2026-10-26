/**
 * Bounded stream verification with ffprobe. Each run probes at most `perRun` streams,
 * choosing those never probed or probed longest ago, with limited concurrency and a hard
 * timeout per stream. Results persist in a small JSON database between runs, so the
 * catalogue gains verified resolution/codec data gradually without hammering servers.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { CatalogueChannel, StreamProbe } from '../shared/model.ts';
import { USER_AGENT } from './fetch.ts';

export interface ProbeRecord {
  ok: boolean;
  at: string;
  width?: number;
  height?: number;
  videoCodec?: string;
  audioCodecs?: string[];
  error?: string;
}

export type ProbeDb = Record<string, ProbeRecord>;

export interface ProbeConfig {
  perRun: number;
  timeoutMs: number;
  concurrency: number;
  maxAgeDays: number;
}

export function loadProbeDb(path: string): ProbeDb {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ProbeDb) : {};
  } catch {
    return {};
  }
}

export function saveProbeDb(path: string, db: ProbeDb): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(db));
}

/** Streams to probe this run: never probed first, then oldest. Pure. */
export function selectForProbe(
  channels: CatalogueChannel[],
  db: ProbeDb,
  perRun: number,
  now = Date.now(),
  maxAgeDays = 14,
  /** Lower runs first among equally stale streams (e.g. home country, preferred language). */
  priority: (ch: CatalogueChannel) => number = () => 0,
): { id: string; url: string }[] {
  const maxAge = maxAgeDays * 86400000;
  const candidates: { id: string; url: string; age: number; prio: number }[] = [];
  for (const ch of channels) {
    const prio = priority(ch);
    for (const s of ch.streams) {
      const rec = db[s.id];
      const age = rec ? now - Date.parse(rec.at) : Infinity;
      if (age > maxAge || !rec) candidates.push({ id: s.id, url: s.url, age, prio });
    }
  }
  candidates.sort((a, b) => (b.age === a.age ? a.prio - b.prio : b.age - a.age));
  return candidates.slice(0, perRun).map(({ id, url }) => ({ id, url }));
}

/** Parses `ffprobe -show_streams -of json` output. Pure. */
export function parseFfprobe(json: string): Omit<ProbeRecord, 'at'> {
  const data = JSON.parse(json) as { streams?: { codec_type?: string; codec_name?: string; width?: number; height?: number }[] };
  const streams = data.streams || [];
  const video = streams.filter((s) => s.codec_type === 'video' && s.width && s.height);
  video.sort((a, b) => (b.height || 0) - (a.height || 0));
  const v = video[0];
  const audio = streams.filter((s) => s.codec_type === 'audio').map((s) => s.codec_name || 'unknown');
  if (!v && !audio.length) return { ok: false, error: 'no media streams' };
  return {
    ok: true,
    width: v ? v.width : undefined,
    height: v ? v.height : undefined,
    videoCodec: v ? v.codec_name : undefined,
    audioCodecs: audio.filter((a, i) => audio.indexOf(a) === i),
  };
}

function ffprobe(url: string, timeoutMs: number): Promise<Omit<ProbeRecord, 'at'>> {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-user_agent', USER_AGENT,
      '-rw_timeout', String(timeoutMs * 1000),
      '-probesize', '2000000',
      '-analyzeduration', '3000000',
      '-show_streams',
      '-of', 'json',
      url,
    ];
    const child = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs + 3000);
    child.stdout.on('data', (d: Buffer) => {
      if (out.length < 1_000_000) out += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 4000) err += d.toString();
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ ok: false, error: e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ ok: false, error: (err.trim().split('\n').pop() || `exit ${code}`).slice(0, 200) });
      try {
        resolve(parseFfprobe(out));
      } catch {
        resolve({ ok: false, error: 'unreadable ffprobe output' });
      }
    });
  });
}

export async function runProbes(
  targets: { id: string; url: string }[],
  db: ProbeDb,
  cfg: ProbeConfig,
  log: (msg: string) => void = () => undefined,
): Promise<number> {
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= targets.length) return;
      const t = targets[i]!;
      const r = await ffprobe(t.url, cfg.timeoutMs);
      db[t.id] = { ...r, at: new Date().toISOString() };
      done++;
      if (done % 25 === 0) log(`probed ${done}/${targets.length}`);
    }
  };
  const workers: Promise<void>[] = [];
  for (let k = 0; k < Math.max(1, cfg.concurrency); k++) workers.push(worker());
  await Promise.all(workers);
  return done;
}

/** Copies probe results onto catalogue streams (successful probes become StreamProbe). Pure. */
export function applyProbes(channels: CatalogueChannel[], db: ProbeDb): void {
  for (const ch of channels) {
    for (const s of ch.streams) {
      const r = db[s.id];
      if (!r) continue;
      s.checkedAt = r.at;
      s.status = r.ok ? 'online' : 'offline';
      if (r.ok && r.width && r.height) {
        const probe: StreamProbe = { width: r.width, height: r.height, at: r.at };
        if (r.videoCodec) probe.videoCodec = r.videoCodec;
        if (r.audioCodecs && r.audioCodecs.length) probe.audioCodecs = r.audioCodecs;
        s.probe = probe;
      }
    }
  }
}
