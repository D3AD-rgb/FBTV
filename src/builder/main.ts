/**
 * Catalogue builder CLI (Node 24, runs TypeScript directly).
 *
 *   node src/builder/main.ts [--out build-data/catalogue] [--probe] [--only iptv-org]
 *
 * Reads config/sources.json and config/overrides.json, builds the normalised catalogue and
 * writes shards plus manifest.json. Every source is isolated: a failure is recorded in the
 * report and the remaining sources still build.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type {
  CatalogueChannel,
  CatalogueManifest,
  CatalogueManifestShard,
  CountryInfo,
  LanguageInfo,
  SourceReport,
} from '../shared/model.ts';
import { parseM3U } from '../shared/m3u.ts';
import { encodeChannels } from '../shared/codec.ts';
import { checkSourceUrl, redactUrl } from '../shared/url.ts';
import { fetchJSON, fetchText, type FetchOptions } from './fetch.ts';
import { buildFromIptvOrg, type IptvOrgData } from './iptvOrg.ts';
import { buildFromM3U } from './m3uSource.ts';
import { mergeChannels, type Overrides } from './merge.ts';
import { applyProbes, loadProbeDb, runProbes, saveProbeDb, selectForProbe, type ProbeConfig } from './probe.ts';

export const BUILDER_VERSION = '0.3.0';

interface SourceConfig {
  id: string;
  name: string;
  type: 'iptv-org-api' | 'm3u' | 'football-data' | 'xmltv' | string;
  url: string;
  enabled: boolean;
  defaults?: { country?: string; languages?: string[]; categories?: string[] };
  secretEnv?: string;
}

interface BuilderConfig {
  sources: SourceConfig[];
  limits: { timeoutMs: number; maxBytes: number };
  probe: ProbeConfig;
}

const ROOT = resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const flag = (name: string) => argv.indexOf(`--${name}`) >= 0;
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1]! : fallback;
};

const log = (msg: string) => console.log(`[builder] ${msg}`);

async function loadIptvOrg(src: SourceConfig, fetchOpts: FetchOptions): Promise<IptvOrgData> {
  const base = src.url.replace(/\/?$/, '/');
  // Sequential on purpose: polite to the host, and avoids connection resets seen with
  // parallel requests from some networks.
  const get = <T>(file: string) => fetchJSON<T>(base + file, fetchOpts);
  const channels = await get<IptvOrgData['channels']>('channels.json');
  const feeds = await get<IptvOrgData['feeds']>('feeds.json');
  const streams = await get<IptvOrgData['streams']>('streams.json');
  const logos = await get<IptvOrgData['logos']>('logos.json');
  const countries = await get<IptvOrgData['countries']>('countries.json');
  const languages = await get<IptvOrgData['languages']>('languages.json');
  const categories = await get<IptvOrgData['categories']>('categories.json');
  const blocklist = await get<IptvOrgData['blocklist']>('blocklist.json');
  return { channels, feeds, streams, logos, countries, languages, categories, blocklist };
}

function writeShard(dir: string, name: string, data: unknown): CatalogueManifestShard {
  const file = `${name}.json`;
  const text = JSON.stringify(data);
  writeFileSync(join(dir, file), text);
  return {
    name,
    file,
    sha256: createHash('sha256').update(text).digest('hex'),
    bytes: Buffer.byteLength(text),
  };
}

async function main() {
  const config = JSON.parse(readFileSync(join(ROOT, 'config', 'sources.json'), 'utf8')) as BuilderConfig;
  const overridesPath = join(ROOT, 'config', 'overrides.json');
  const overrides = existsSync(overridesPath) ? (JSON.parse(readFileSync(overridesPath, 'utf8')) as Overrides) : {};
  const outDir = resolve(ROOT, opt('out', 'build-data/catalogue'));
  const cacheDir = resolve(ROOT, 'build-data', 'http-cache');
  const probeDbPath = resolve(ROOT, opt('probe-db', 'build-data/probe-db.json'));
  const only = opt('only', '');
  const fetchOpts: FetchOptions = { timeoutMs: config.limits.timeoutMs, maxBytes: config.limits.maxBytes, cacheDir };

  const reports: SourceReport[] = [];
  const lists: CatalogueChannel[][] = [];
  let countries: CountryInfo[] = [];
  let languages: LanguageInfo[] = [];
  let categories: { id: string; name: string }[] = [];
  const knownIds = new Set<string>();
  const dropped: Record<string, number> = {};

  // iptv-org first: it is the most trusted source and wins duplicate URLs.
  const ordered = config.sources.slice().sort((a, b) => (a.type === 'iptv-org-api' ? -1 : b.type === 'iptv-org-api' ? 1 : 0));
  for (const src of ordered) {
    if (!src.enabled || (only && src.id !== only)) continue;
    const report: SourceReport = { id: src.id, name: src.name, ok: false };
    reports.push(report);
    const check = checkSourceUrl(src.url);
    if (!check.ok) {
      report.error = `Invalid URL: ${check.reason}`;
      log(`${src.id}: ${report.error}`);
      continue;
    }
    try {
      if (src.type === 'iptv-org-api') {
        log(`${src.id}: fetching ${redactUrl(src.url)}`);
        const data = await loadIptvOrg(src, fetchOpts);
        const r = buildFromIptvOrg(data);
        lists.push(r.channels);
        r.channels.forEach((c) => knownIds.add(c.id));
        countries = r.countries;
        languages = r.languages;
        categories = r.categories;
        Object.keys(r.dropped).forEach((k) => (dropped[`${src.id}:${k}`] = r.dropped[k]!));
        report.entries = r.channels.length;
      } else if (src.type === 'm3u') {
        log(`${src.id}: fetching ${redactUrl(src.url)}`);
        const text = (await fetchText(src.url, fetchOpts)).body;
        const parsed = parseM3U(text);
        const r = buildFromM3U(parsed.entries, { id: src.id, defaults: src.defaults }, knownIds);
        lists.push(r.channels);
        Object.keys(r.dropped).forEach((k) => (dropped[`${src.id}:${k}`] = r.dropped[k]!));
        if (parsed.warnings.length) dropped[`${src.id}:warnings`] = parsed.warnings.length;
        report.entries = r.channels.length;
      } else if (src.type === 'football-data' || src.type === 'xmltv') {
        report.error = 'Handled by a later builder stage (not part of the channel catalogue).';
        report.ok = true;
        continue;
      } else {
        report.error = `Unknown source type "${src.type}"`;
        continue;
      }
      report.ok = true;
      report.lastSuccess = new Date().toISOString();
      log(`${src.id}: ${report.entries} channels`);
    } catch (err) {
      report.error = (err as Error).message.replace(/https?:\/\/\S+/g, (u) => redactUrl(u));
      log(`${src.id}: FAILED — ${report.error}`);
    }
  }

  const merged = mergeChannels(lists, overrides);
  const channels = merged.channels;

  const db = loadProbeDb(probeDbPath);
  if (flag('probe')) {
    // UK first, then English-language channels (the owner's home country and language).
    const priority = (c: CatalogueChannel) => (c.country === 'UK' ? 0 : (c.languages || []).indexOf('eng') >= 0 ? 1 : 2);
    const targets = selectForProbe(channels, db, config.probe.perRun, Date.now(), config.probe.maxAgeDays, priority);
    log(`probing ${targets.length} streams (ffprobe, concurrency ${config.probe.concurrency})`);
    await runProbes(targets, db, config.probe, log);
    saveProbeDb(probeDbPath, db);
  }
  applyProbes(channels, db);

  mkdirSync(outDir, { recursive: true });
  const streamsTotal = channels.reduce((n, c) => n + c.streams.length, 0);
  const counts: Record<string, number> = {
    channels: channels.length,
    streams: streamsTotal,
    countries: countries.length,
    verified: channels.filter((c) => c.streams.some((s) => s.probe)).length,
    verifiedUhd: channels.filter((c) => c.streams.some((s) => s.probe && (s.probe.height >= 2160 || s.probe.width >= 3840))).length,
    kids: channels.filter((c) => c.kids).length,
    duplicatesMerged: merged.duplicates,
    hiddenByOverride: merged.hidden,
  };
  const generatedAt = new Date().toISOString();
  const shards = [
    writeShard(outDir, 'channels', encodeChannels(channels)),
    writeShard(outDir, 'countries', countries),
    writeShard(outDir, 'languages', languages),
    writeShard(outDir, 'categories', categories),
    writeShard(outDir, 'report', { generatedAt, sources: reports, dropped, counts }),
  ];
  const manifest: CatalogueManifest = {
    schema: 1,
    generatedAt,
    builderVersion: BUILDER_VERSION,
    shards,
    sources: reports,
    counts,
  };
  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  log(`wrote ${outDir}`);
  log(`counts ${JSON.stringify(counts)}`);
  log(`dropped ${JSON.stringify(dropped)}`);
  const failed = reports.filter((r) => !r.ok);
  if (failed.length && failed.length === reports.length) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
