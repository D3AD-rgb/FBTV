/**
 * FBTV local source library CLI (data lives in IPTV_DATA_DIR, default ../FBTV-local-data).
 *
 *   refresh  [--offline] [--no-fixtures] [--no-archive] [--only repo,…]   collect → providers → inventory → fixtures → catalogs → TV export → report
 *   rebuild                                 inventory → catalogs → export → report from stored data (no network)
 *   validate [--limit N] [--playable N] [--force] [--concurrency N]
 *   fixtures [--offline] [--listings N]     refresh fixtures only (offline: stored responses only)
 *   export | serve [--port 8787] | report
 *   secret set|remove <profile-id> · xtream test <profile-id>
 */
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collect, loadManifest } from './collect.ts';
import { buildInventory, loadApi, readInventory, writeInventory, type InventoryRecord } from './inventory.ts';
import { buildCatalogs } from './catalogs.ts';
import { collectFixtures, type FixtureResult } from './fixtures.ts';
import { resolveArchive } from './archive.ts';
import { exportForTv, serve } from './export.ts';
import { writeReport } from './report.ts';
import { dataDir, ensureDataDir } from './paths.ts';
import { ensureProfiles, loadProfiles, type XtreamProfile } from './profiles.ts';
import { importProviders, type ProviderReport } from './providers.ts';
import { getCredentials, maskSecrets, removeCredentials, setCredentials } from './secrets.ts';
import { targetsFrom, validate } from './validate.ts';
import { detectCapabilities } from './xtream.ts';

const [cmd, ...rest] = process.argv.slice(2);
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const flag = (name: string) => rest.indexOf(`--${name}`) >= 0;

function logger(dir: string) {
  const file = join(dir, 'logs', `library-${new Date().toISOString().slice(0, 10)}.log`);
  return (m: string) => {
    console.log(`[library] ${m}`);
    appendFileSync(file, `[${new Date().toISOString()}] ${m}\n`);
  };
}

const README = `# FBTV local source library

Maintained by \`npm run library:refresh\` in the FBTV repository. This folder is deliberately
**outside** Git: it holds downloaded originals, your own playlists, provider profiles and
encrypted credentials.

| Path | What it is |
|---|---|
| \`manifest.json\` | Every matched source file: repository, original path/URL, retrieval time, SHA-256, licence, permission, stored or referenced |
| \`catalogs/inventory.jsonl\` | **Every discovered record** (one JSON per line) with source file + line, status, reasons, validation |
| \`catalogs/channels.json\` | Normalised channels; every alternative stream with its provenance and status |
| \`catalogs/football.json\`, \`sports.json\`, \`fixtures.json\` | Football channels by role, sports by sport, fixtures (schedule data, never streams) |
| \`catalogs/movies.json\`, \`series.json\`, \`episodes.json\` | VOD in English, Hindi, Bengali (Layer B) |
| \`catalogs/vod-inventory.json\`, \`vod-language-review.json\` | All VOD records (Layer A) and those awaiting language review |
| \`catalogs/source-status.json\` | Validation results by stream |
| \`source-registry.json\` | Dropdown items, generated from the data (add a profile or playlist → it appears) |
| \`repositories/<repo>/\` | Original files, byte-for-byte |
| \`playlists/\` | Generated M3U by country, language, category, source, sport, football role, news… |
| \`provider-profiles/\` | profiles.example.json, your profiles.local.json, secrets.dpapi.json (DPAPI-encrypted) |
| \`generated/\` | Imported profile playlists, Xtream catalogues, capabilities, report.json |
| \`cache/\` | Git snapshots and HTTP cache (safe to delete) |
| \`logs/\` | Run logs (credentials never logged) |

Statuses: imported · duplicate_reference · unsupported_format · requires_provider_access · restricted (URL withheld,
reason recorded) · malformed · test_fixture · reference_only. Validation: untested · reachable ·
temporarily_unavailable · playback_confirmed · playback_failed.
`;

async function prompt(question: string, hidden: boolean): Promise<string> {
  const { stdin, stdout } = process;
  stdout.write(question);
  return new Promise((resolve) => {
    let value = '';
    if (hidden && stdin.isTTY) stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          if (hidden && stdin.isTTY) stdin.setRawMode(false);
          stdin.off('data', onData);
          stdin.pause();
          if (hidden) stdout.write('\n');
          resolve(value);
          return;
        }
        if (ch === '\u0003') process.exit(130);
        if (ch === '\u0008' || ch === '\u007f') value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on('data', onData);
  });
}

function loadFixtures(dir: string): FixtureResult | null {
  const p = join(dir, 'catalogs/fixtures.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as FixtureResult) : null;
}

function providersLast(dir: string): ProviderReport[] {
  const p = join(dir, 'generated/providers-last.json');
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as ProviderReport[]) : [];
}

async function derive(dir: string, log: (m: string) => void, records: InventoryRecord[], inventoryErrors: { file: string; error: string }[]) {
  const manifest = loadManifest(dir);
  const fixtures = loadFixtures(dir);
  const cat = buildCatalogs(dir, records, fixtures, undefined, log);
  writeInventory(dir, records);
  const exp = exportForTv(dir, cat.channels, cat.registry);
  log(`catalogs: ${cat.channels.length} channels, ${cat.registry.items.length} registry items; TV export ${exp.dir}`);
  writeReport({ dir, manifest, records, channels: cat.channels, registry: cat.registry, vod: cat.vod, fixtures, providers: providersLast(dir), inventoryErrors, exportInfo: exp });
  log(`wrote ${join(dir, 'REPORT.md')}`);
}

async function main() {
  const dir = ensureDataDir(dataDir());
  const log = logger(dir);
  switch (cmd) {
    case 'refresh': {
      writeFileSync(join(dir, 'README.md'), README);
      ensureProfiles(dir);
      log(`data directory ${dir}`);
      const only = opt('only') ? opt('only')!.split(',') : undefined;
      const manifest = await collect(dir, log, { offline: flag('offline'), only });
      if (!flag('no-archive')) await resolveArchive(dir, log, { offline: flag('offline') });
      const providers = flag('offline') ? providersLast(dir) : await importProviders(dir, log);
      writeFileSync(join(dir, 'generated/providers-last.json'), JSON.stringify(providers, null, 2));
      const inv = await buildInventory(dir, manifest, loadApi(dir), log);
      log(`inventory: ${inv.records.length} records`);
      if (!flag('no-fixtures')) await collectFixtures(dir, log, { offline: flag('offline'), listings: opt('listings') ? Number(opt('listings')) : undefined });
      await derive(dir, log, inv.records, inv.errors);
      break;
    }
    case 'rebuild': {
      const manifest = loadManifest(dir);
      if (!manifest.files.length) throw new Error('Library is empty — run `npm run library:refresh` first.');
      const inv = await buildInventory(dir, manifest, loadApi(dir), log);
      await derive(dir, log, inv.records, inv.errors);
      break;
    }
    case 'fixtures': {
      const r = await collectFixtures(dir, log, { offline: flag('offline'), listings: opt('listings') ? Number(opt('listings')) : undefined });
      log(`fixtures: ${r.fixtures.length} events in ${r.competitions.length} competitions`);
      await derive(dir, log, readInventory(dir), []);
      break;
    }
    case 'validate': {
      const records = readInventory(dir);
      if (!records.length) throw new Error('Inventory is empty — run `npm run library:refresh` first.');
      const r = await validate(dir, targetsFrom(records), {
        limit: opt('limit') ? Number(opt('limit')) : undefined,
        playable: opt('playable') ? Number(opt('playable')) : 0,
        force: flag('force'),
        concurrency: opt('concurrency') ? Number(opt('concurrency')) : undefined,
        log,
      });
      log(`checked ${r.checked}, reachable ${r.reachable}; ffprobe ${r.playableChecked}, playable ${r.playable}`);
      await derive(dir, log, records, []);
      break;
    }
    case 'export': {
      await derive(dir, log, readInventory(dir), []);
      break;
    }
    case 'serve':
      serve(opt('port') ? Number(opt('port')) : 8787);
      return;
    case 'report':
      await derive(dir, log, readInventory(dir), []);
      process.stdout.write(readFileSync(join(dir, 'REPORT.md'), 'utf8'));
      break;
    case 'secret': {
      const [action, id] = rest;
      if (!id) throw new Error('Usage: secret set|remove <profile-id>');
      if (action === 'set') {
        const username = await prompt(`Username for ${id}: `, false);
        const password = await prompt(`Password for ${id} (hidden): `, true);
        const scheme = setCredentials(dir, id, { username, password });
        console.log(`Stored credentials for ${id} (${scheme === 'dpapi' ? 'encrypted with Windows DPAPI for this Windows user' : 'file readable only by you'}).`);
      } else if (action === 'remove') console.log(removeCredentials(dir, id) ? `Removed credentials for ${id}.` : `No credentials stored for ${id}.`);
      else throw new Error('Usage: secret set|remove <profile-id>');
      break;
    }
    case 'xtream': {
      const [action, id] = rest;
      if (action !== 'test' || !id) throw new Error('Usage: xtream test <profile-id>');
      const p = loadProfiles(dir).profiles.filter((x) => x.id === id && x.type === 'xtream')[0] as XtreamProfile | undefined;
      if (!p) throw new Error(`No Xtream profile "${id}" in profiles.local.json`);
      const c = getCredentials(dir, id);
      if (!c) throw new Error(`No credentials stored for ${id}`);
      console.log(maskSecrets(JSON.stringify(await detectCapabilities(p, c), null, 2), c));
      break;
    }
    default:
      console.log('Usage: node src/library/main.ts refresh | rebuild | validate | fixtures | export | serve | report | secret | xtream');
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`[library] ${(err as Error).stack || (err as Error).message}`);
  process.exitCode = 1;
});
