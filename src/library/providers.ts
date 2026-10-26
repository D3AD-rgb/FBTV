/**
 * Imports your provider profiles:
 *  - M3U profiles: copies the playlist (file or URL) to generated/profiles/<id>.m3u.
 *  - Xtream profiles with stored credentials: detects capabilities, then imports VOD and
 *    series lists, and episode lists for a capped number of series per run (rate-limited).
 * Everything stays in the local data directory. Errors are recorded with secrets masked.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fetchText } from '../builder/fetch.ts';
import { redactUrl } from '../shared/url.ts';
import { loadProfiles, type XtreamProfile } from './profiles.ts';
import { getCredentials, maskSecrets } from './secrets.ts';
import { detectCapabilities, importEpisodes, importSeries, importVod, type Fetcher, type SeriesItem, type XtreamCapabilities, defaultFetcher } from './xtream.ts';

export interface ProviderReport {
  id: string;
  type: string;
  ok: boolean;
  detail: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function importProviders(dir: string, log: (m: string) => void, fetcher: Fetcher = defaultFetcher): Promise<ProviderReport[]> {
  const { profiles } = loadProfiles(dir);
  const out: ProviderReport[] = [];
  const capsPath = join(dir, 'generated/provider-capabilities.json');
  const caps: Record<string, XtreamCapabilities> = existsSync(capsPath) ? JSON.parse(readFileSync(capsPath, 'utf8')) : {};
  mkdirSync(join(dir, 'generated/profiles'), { recursive: true });

  for (const p of profiles) {
    if (!p.enabled) {
      out.push({ id: p.id, type: p.type, ok: true, detail: 'disabled' });
      continue;
    }
    if (p.type === 'm3u') {
      const target = join(dir, 'generated/profiles', `${p.id}.m3u`);
      try {
        if (p.file) {
          if (!existsSync(p.file)) throw new Error(`file not found: ${p.file}`);
          copyFileSync(p.file, target);
        } else if (p.url) {
          const r = await fetchText(p.url, { timeoutMs: 60000, maxBytes: 80 * 1024 * 1024, cacheDir: join(dir, 'cache/http') });
          writeFileSync(target, r.body);
        }
        out.push({ id: p.id, type: 'm3u', ok: true, detail: 'imported' });
        log(`profile ${p.id}: playlist imported`);
      } catch (err) {
        const msg = (err as Error).message.replace(/https?:\/\/\S+/g, (u) => redactUrl(u));
        out.push({ id: p.id, type: 'm3u', ok: false, detail: msg });
        log(`profile ${p.id}: FAILED ${msg}`);
      }
      continue;
    }
    const xp = p as XtreamProfile;
    const creds = getCredentials(dir, xp.id);
    if (!creds) {
      out.push({ id: xp.id, type: 'xtream', ok: false, detail: `no credentials stored (npm run library:secret -- set ${xp.id})` });
      continue;
    }
    try {
      const c = await detectCapabilities(xp, creds, fetcher);
      caps[xp.id] = { ...c, errors: c.errors.map((e) => maskSecrets(e, creds)) };
      if (!c.authenticated) throw new Error('authentication failed');
      const folder = join(dir, 'generated/xtream', xp.id);
      mkdirSync(folder, { recursive: true });
      if (c.vod) {
        const vod = await importVod(xp, creds, fetcher);
        writeFileSync(join(folder, 'vod.json'), JSON.stringify(vod));
        log(`profile ${xp.id}: ${vod.length} VOD items`);
      }
      if (c.series) {
        const prevPath = join(folder, 'series.json');
        const prev: SeriesItem[] = existsSync(prevPath) ? JSON.parse(readFileSync(prevPath, 'utf8')) : [];
        const withEpisodes = new Map(prev.filter((s) => s.seasons).map((s) => [s.seriesId, s]));
        let series = await importSeries(xp, creds, fetcher);
        series = series.map((s) => withEpisodes.get(s.seriesId) || s);
        const budget = xp.episodesPerRefresh === undefined ? 50 : xp.episodesPerRefresh;
        let fetched = 0;
        for (let i = 0; i < series.length && fetched < budget; i++) {
          if (series[i]!.seasons) continue;
          try {
            series[i] = await importEpisodes(xp, creds, series[i]!, fetcher);
          } catch (err) {
            log(`profile ${xp.id}: episodes for one series failed: ${maskSecrets((err as Error).message, creds)}`);
          }
          fetched++;
          await sleep(500); // at most 2 requests per second
        }
        writeFileSync(prevPath, JSON.stringify(series));
        log(`profile ${xp.id}: ${series.length} series (${series.filter((s) => s.seasons).length} with episode lists)`);
      }
      out.push({ id: xp.id, type: 'xtream', ok: true, detail: `live ${c.live}, vod ${c.vod}, series ${c.series}, xmltv ${c.xmltv}` });
    } catch (err) {
      const msg = maskSecrets((err as Error).message, creds);
      out.push({ id: xp.id, type: 'xtream', ok: false, detail: msg });
      log(`profile ${xp.id}: FAILED ${msg}`);
    }
  }
  writeFileSync(capsPath, JSON.stringify(caps, null, 2));
  return out;
}
