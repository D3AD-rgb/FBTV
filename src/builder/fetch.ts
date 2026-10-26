/**
 * Polite HTTP fetching for the catalogue builder: timeouts, response size caps, an
 * identifying User-Agent, and conditional requests (ETag / Last-Modified) cached on disk
 * so unchanged sources are not downloaded again.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  cacheDir?: string;
  headers?: Record<string, string>;
}

export interface FetchResult {
  url: string;
  status: number;
  body: string;
  fromCache: boolean;
}

export const USER_AGENT = 'FBTV-catalogue-builder/0.3 (+https://github.com/; personal IPTV catalogue)';

interface CacheMeta {
  etag?: string;
  lastModified?: string;
}

function cachePaths(cacheDir: string, url: string) {
  const key = createHash('sha1').update(url).digest('hex');
  return { body: join(cacheDir, `${key}.body`), meta: join(cacheDir, `${key}.json`) };
}

/** Retries transient failures (connection resets, timeouts, 5xx) with backoff; never 4xx. */
export async function fetchText(url: string, opts: FetchOptions & { retries?: number } = {}): Promise<FetchResult> {
  const retries = opts.retries === undefined ? 2 : opts.retries;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchOnce(url, opts);
    } catch (err) {
      lastErr = err as Error;
      const msg = lastErr.message;
      const transient = !/HTTP 4\d\d|too large|exceeded|non-HTTPS/.test(msg);
      if (!transient || attempt === retries) break;
      await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
    }
  }
  const cause = lastErr && (lastErr as Error & { cause?: { code?: string } }).cause;
  throw new Error(`${lastErr ? lastErr.message : 'fetch failed'}${cause && cause.code ? ` (${cause.code})` : ''}`);
}

async function fetchOnce(url: string, opts: FetchOptions): Promise<FetchResult> {
  if (!/^https:\/\//i.test(url)) throw new Error(`Refusing non-HTTPS source URL: ${url}`);
  const timeoutMs = opts.timeoutMs || 60000;
  const maxBytes = opts.maxBytes || 50 * 1024 * 1024;
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: '*/*', ...(opts.headers || {}) };

  let paths: { body: string; meta: string } | null = null;
  if (opts.cacheDir) {
    mkdirSync(opts.cacheDir, { recursive: true });
    paths = cachePaths(opts.cacheDir, url);
    if (existsSync(paths.meta) && existsSync(paths.body)) {
      const meta = JSON.parse(readFileSync(paths.meta, 'utf8')) as CacheMeta;
      if (meta.etag) headers['If-None-Match'] = meta.etag;
      if (meta.lastModified) headers['If-Modified-Since'] = meta.lastModified;
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal, redirect: 'follow' });
    if (res.status === 304 && paths) {
      return { url, status: 304, body: readFileSync(paths.body, 'utf8'), fromCache: true };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error(`Response too large (${declared} bytes > ${maxBytes}) for ${url}`);
    const reader = res.body ? res.body.getReader() : null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          controller.abort();
          throw new Error(`Response exceeded ${maxBytes} bytes for ${url}`);
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
    if (paths) {
      writeFileSync(paths.body, body);
      const meta: CacheMeta = {
        etag: res.headers.get('etag') || undefined,
        lastModified: res.headers.get('last-modified') || undefined,
      };
      writeFileSync(paths.meta, JSON.stringify(meta));
    }
    return { url, status: res.status, body, fromCache: false };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Timed out after ${timeoutMs} ms: ${url}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJSON<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const r = await fetchText(url, opts);
  try {
    return JSON.parse(r.body) as T;
  } catch {
    throw new Error(`Invalid JSON from ${url}`);
  }
}
