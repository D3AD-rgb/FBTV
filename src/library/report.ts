/**
 * Collection report (Rule 11). Every number is computed from files in the data directory —
 * inventory.jsonl, manifest.json, catalogs, fixtures and the validation database.
 */
import { writeFileSync } from 'node:fs';
import { loadRights, rightsSummary } from './broadcasters.ts';
import { join } from 'node:path';
import type { Manifest } from './collect.ts';
import type { InventoryRecord } from './inventory.ts';
import type { CatalogChannel, CatalogsResult, Registry } from './catalogs.ts';
import { LANG_LABEL, TARGET_VOD_LANGUAGES } from './catalogs.ts';
import type { FixtureResult } from './fixtures.ts';
import type { ProviderReport } from './providers.ts';
import { SPORTS } from './policy.ts';

export interface ReportInput {
  dir: string;
  manifest: Manifest;
  records: InventoryRecord[];
  channels: CatalogChannel[];
  registry: Registry;
  vod: CatalogsResult['vod'];
  fixtures: FixtureResult | null;
  providers: ProviderReport[];
  inventoryErrors: { file: string; error: string }[];
  tests?: string;
  exportInfo?: { dir: string; files: Record<string, number> };
}

const n = (x: number) => x.toLocaleString('en-GB');

function tally<T>(xs: T[], key: (x: T) => string): [string, number][] {
  const m = new Map<string, number>();
  for (const x of xs) m.set(key(x), (m.get(key(x)) || 0) + 1);
  return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
}

export function writeReport(input: ReportInput): string {
  const { dir, manifest, records, channels, registry, fixtures } = input;
  const L: string[] = [];
  const P = (s = '') => L.push(s);
  const streams = records.filter((r) => r.kind === 'stream' || r.kind === 'radio' || r.kind === 'vod');
  const live = channels.filter((c) => c.kind === 'stream');

  P('# FBTV local source library — collection report');
  P();
  P(`Generated ${new Date().toISOString()} · data directory \`${dir}\``);
  P();
  P('Nothing discovered is silently dropped. Every record is in `catalogs/inventory.jsonl` with its source file and line, a status and the reason for that status. Playlists and catalogs are views over it.');
  P();

  P('## 1. Repositories inspected');
  P();
  P('| Repository | Snapshot | Files in repo | Matched | Stored | Referenced | Not source data | Status |');
  P('|---|---|---|---|---|---|---|---|');
  for (const a of manifest.repositories) {
    const nsd = Object.values(a.notSourceData).reduce((x, y) => x + y, 0);
    P(`| [${a.name}](${a.url}) | ${a.commit ? `${a.commit} · ${(a.commitDate || '').slice(0, 10)}` : 'remote'} | ${a.filesInRepo || '—'} | ${a.matched} | ${a.stored} | ${a.referenced} | ${nsd} | ${a.status}${a.error ? ` (${a.error})` : ''} |`);
  }
  P();
  for (const a of manifest.repositories) {
    const nsd = tally(Object.entries(a.notSourceData).flatMap(([k, v]) => Array(v).fill(k) as string[]), (x) => x).slice(0, 6);
    P(`- **${a.name}** — ${a.summary} Licence: ${a.licence}.${nsd.length ? ` Not source data: ${nsd.map(([k, v]) => `${v}× ${k}`).join(', ')}.` : ''}`);
    for (const r of a.references) P(`  - Reference: ${r.url} — ${r.reason}`);
  }
  P();

  P('## 2–3. Files discovered, downloaded and referenced');
  P();
  const byCat = tally(manifest.files, (f) => `${f.category} · ${f.status}`);
  P('| Category · status | Files |');
  P('|---|---|');
  for (const [k, v] of byCat) P(`| ${k} | ${v} |`);
  P(`| **Total** | ${manifest.files.length} (stored ${manifest.files.filter((f) => f.stored).length}, ${((manifest.files.filter((f) => f.stored).reduce((x, f) => x + (f.bytes || 0), 0)) / 1048576).toFixed(1)} MB) |`);
  const refd = manifest.files.filter((f) => f.status === 'referenced');
  if (refd.length) {
    P();
    P('Referenced, not stored (entries inventoried; original stays at its source):');
    for (const [reason, count] of tally(refd, (f) => `${f.repo}: ${f.reason || 'referenced'}`)) P(`- ${count} file(s) — ${reason}`);
  }
  P();

  P('## 4. Playlists discovered and saved');
  P();
  const playlistFiles = manifest.files.filter((f) => f.category === 'live-tv' || f.category === 'radio' || f.category === 'test-fixture');
  P(`${playlistFiles.length} playlist files (${playlistFiles.filter((f) => f.stored).length} saved as originals, ${playlistFiles.filter((f) => !f.stored).length} referenced) — ${n(streams.length)} stream entries parsed, ${n(records.filter((r) => r.kind === 'malformed-line').length)} malformed lines recorded.`);
  P();
  P('| Source | Playlist files | Entries |');
  P('|---|---|---|');
  for (const [repo] of tally(playlistFiles, (f) => f.repo)) {
    P(`| ${repo} | ${playlistFiles.filter((f) => f.repo === repo).length} | ${n(streams.filter((r) => r.source.repo === repo).length)} |`);
  }
  P();

  P('## 5. Inventory and live TV');
  P();
  P('| Record status | Count |');
  P('|---|---|');
  for (const [k, v] of tally(records, (r) => r.status)) P(`| ${k} | ${n(v)} |`);
  P(`| **All records** | ${n(records.length)} |`);
  P();
  P('| Record kind | Count |');
  P('|---|---|');
  for (const [k, v] of tally(records, (r) => r.kind)) P(`| ${k} | ${n(v)} |`);
  P();
  P(`Normalised channels: **${n(live.length)}** live (${n(live.filter((c) => c.playable).length)} with a stream the TV can attempt), radio ${n(channels.length - live.length)}. Streams kept as alternatives: ${n(channels.reduce((x, c) => x + c.streams.length, 0))}.`);
  P(`UK ${n(live.filter((c) => c.country === 'UK').length)} · English ${n(live.filter((c) => c.languages.indexOf('eng') >= 0).length)} · Hindi ${n(live.filter((c) => c.languages.indexOf('hin') >= 0).length)} · Bengali ${n(live.filter((c) => c.languages.indexOf('ben') >= 0).length)} · Arabic ${n(live.filter((c) => c.languages.indexOf('ara') >= 0).length)} · countries ${new Set(live.map((c) => c.country).filter(Boolean)).size} · languages ${new Set(live.flatMap((c) => c.languages)).size}`);
  P();
  P('Reasons recorded for entries that are not imported as playable:');
  for (const [k, v] of tally(records.filter((r) => r.status !== 'imported' && r.status !== 'duplicate_reference'), (r) => `${r.status}: ${r.reasons[0] || ''}`).slice(0, 25)) P(`- ${n(v)} — ${k}`);
  P();

  P('## 6. Sports and football channels');
  P();
  const sports = live.filter((c) => c.sports.length || c.categories.indexOf('sports') >= 0);
  P(`Sports channels: **${n(sports.length)}** (English ${n(sports.filter((c) => c.languages.indexOf('eng') >= 0).length)}, Arabic ${n(sports.filter((c) => c.languages.indexOf('ara') >= 0).length)}, other/unknown language ${n(sports.filter((c) => c.languages.indexOf('eng') < 0 && c.languages.indexOf('ara') < 0).length)}).`);
  P();
  P('| Sport | Channels | Playable |');
  P('|---|---|---|');
  for (const sp of SPORTS) {
    const list = sports.filter((c) => c.sports.indexOf(sp.id) >= 0);
    P(`| ${sp.name} | ${list.length} | ${list.filter((c) => c.playable).length} |`);
  }
  P(`| Multi-sport & general | ${sports.filter((c) => !c.sports.length).length} | ${sports.filter((c) => !c.sports.length && c.playable).length} |`);
  P();
  const fb = live.filter((c) => c.football || c.sports.indexOf('football') >= 0);
  P(`Football channels: **${n(fb.length)}** — dedicated ${fb.filter((c) => c.football === 'dedicated').length}, club TV ${fb.filter((c) => c.football === 'club').length}, broadcaster brands ${fb.filter((c) => c.football === 'broadcaster-brand').length}, tagged by name ${fb.filter((c) => !c.football).length}. English ${fb.filter((c) => c.languages.indexOf('eng') >= 0).length}, Arabic ${fb.filter((c) => c.languages.indexOf('ara') >= 0).length}. Pay-TV brands among them (kept, flagged): ${fb.filter((c) => c.payTvBrand).length}.`);
  P('Language is the feed’s broadcast language; commentary language is not verified.');
  P();
  if (fixtures) {
    P('### Fixtures (schedule data, separate from streams)');
    P();
    P('| Competition | Sport | Providers | Fixtures | Tier | Note |');
    P('|---|---|---|---|---|---|');
    for (const c of fixtures.competitions.slice().sort((a, b) => b.tier - a.tier)) P(`| ${c.name} | ${c.sport} | ${c.providers.join(', ') || '—'} | ${c.fixtures} | ${c.tier} | ${c.error || ''} |`);
    const f = fixtures.fixtures;
    const now = Date.now();
    P();
    const rights = loadRights(() => undefined);
    if (rights.size) {
      const sum = rightsSummary(Array.from(rights.values()));
      P();
      P(`Broadcast rights holders researched for ${sum.competitions} competitions (config/broadcasters/, each entry with its source): ${n(sum.countries)} country/region entries, ${n(sum.channels)} channel listings, ${n(sum.freeToAir)} free-to-air. Channels of the same name and country with a public stream in this library: ${n(sum.linked)} (${n(sum.playable)} playable). Pay-TV relays are never linked.`);
      P();
      P('| Competition | Countries/regions | Free-to-air listings | Season | Checked |');
      P('|---|---|---|---|---|');
      for (const r of Array.from(rights.values()).sort((a, b) => a.competitionId.localeCompare(b.competitionId)))
        P(`| ${r.competitionId} | ${r.broadcasters.length} | ${r.broadcasters.reduce((x, b) => x + b.channels.filter((c) => c.freeToAir).length, 0)} | ${r.season} | ${r.retrieved} |`);
    }
    P();
    P(`Total events: ${n(f.length)} — finished ${n(f.filter((x) => x.status === 'finished').length)}, upcoming ${n(f.filter((x) => x.kickoffUtc && Date.parse(x.kickoffUtc) > now).length)}, kick-off time TBC ${n(f.filter((x) => !x.timeKnown).length)}. With TV listings: ${f.filter((x) => x.broadcasts.length).length} matches (${n(f.reduce((x, y) => x + y.broadcasts.length, 0))} listings). Verified live status: none (needs a football-data.org key).`);
    P();
  }

  P('## 7–8. On-demand (VOD)');
  P();
  P('| Language | Movies | Series | Episodes |');
  P('|---|---|---|---|');
  for (const l of TARGET_VOD_LANGUAGES) {
    const v = input.vod.byLanguage[l] || { movies: 0, series: 0, episodes: 0 };
    P(`| ${LANG_LABEL[l]} | ${v.movies} | ${v.series} | ${v.episodes} |`);
  }
  P(`| Unknown language (review list) | ${n(input.vod.unknown)} | — | — |`);
  P(`| Other languages (not shown) | ${n(input.vod.other)} | — | — |`);
  P();
  const vodBy = new Map<string, number>();
  for (const r of records) if (r.kind === 'vod' && r.status === 'imported') vodBy.set(r.source.repo, (vodBy.get(r.source.repo) || 0) + 1);
  const ia = records.filter((r) => r.source.repo === 'internet-archive');
  P(`VOD records in the inventory: ${n(input.vod.inventory)} (direct media files, positive durations and Internet Archive items). Playable by source: ${Array.from(vodBy.entries()).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${n(v)}`).join(', ') || 'none'}.`);
  P();
  P(`**None of the nine repositories contains on-demand English, Hindi or Bengali films or series**; their movie/series lists are 24/7 linear channels, kept under Live TV. On-demand titles come from the Internet Archive (items marked public domain whose year and title make that credible: ${n(ia.filter((r) => r.status === 'imported').length)} playable files; ${n(ia.filter((r) => r.status === 'restricted').length)} items marked public domain were excluded with the reason recorded, e.g. recent films and rips) and from providers you configure. Unlicensed VOD sites (YTS, scraper playlists such as TMDB-To-VOD-Playlist) are not used.`);
  P();

  P('## 9. APIs and provider adapters discovered');
  P();
  for (const r of records.filter((x) => x.kind === 'provider-adapter')) P(`- ${r.name} (${r.source.repo}:${r.source.file}) — ${r.reasons[0]}${(r.meta.extra && r.meta.extra.supportedByFbtv) ? '; supported by the FBTV library' : '; not implemented'}`);
  P('- TheSportsDB (free key) — fixtures for European competitions, cups, leagues and other sports; TV listings per match.');
  P('- openfootball — full-season league fixtures (public domain).');
  P('- football-data.org — live status and scores (free key required).');
  P(`- Programme guides advertised by sources: ${records.filter((x) => x.kind === 'epg-source').length}`);
  P();

  P('## 10. Validation');
  P();
  const uniq = new Map<string, InventoryRecord>();
  for (const r of records) if (r.streamId && r.url && (r.status === 'imported' || r.status === 'duplicate_reference') && !uniq.has(r.streamId)) uniq.set(r.streamId, r);
  const vals = tally(Array.from(uniq.values()), (r) => r.validation);
  P(`Unique stream URLs the TV could attempt: ${n(uniq.size)}`);
  P();
  P('| Validation | Streams |');
  P('|---|---|');
  for (const [k, v] of vals) P(`| ${k} | ${n(v)} |`);
  P();
  P('"reachable" means the server answered with playlist/media bytes; only "playback_confirmed" (ffprobe found audio/video) means it plays.');
  P();

  P('## 11. Unavailable or unsupported, with reasons');
  P();
  for (const [k, v] of tally(records.filter((r) => ['unsupported_format', 'restricted', 'requires_provider_access', 'malformed', 'test_fixture'].indexOf(r.status) >= 0), (r) => `${r.status} — ${r.reasons[0] || ''}`).slice(0, 30)) P(`- ${n(v)} × ${k}`);
  for (const e of input.inventoryErrors) P(`- Could not read ${e.file}: ${e.error}`);
  for (const f of manifest.files.filter((x) => x.status === 'failed')) P(`- Download failed (reference kept for retry): ${f.origin} — ${f.error}`);
  P();

  P('## 12. Sources requiring credentials or other access');
  P();
  P(`- Restricted (URL withheld): ${n(records.filter((r) => r.status === 'restricted').length)} records — ${tally(records.filter((r) => r.status === 'restricted'), (r) => r.urlWithheldReason || r.reasons[0] || '').map(([k, v]) => `${v} × ${k}`).join('; ')}`);
  P(`- Requires provider/network access: ${n(records.filter((r) => r.status === 'requires_provider_access').length)} records (ISP/LAN-only streams, my-tv's token-protected channels, Xtream/Stalker adapters).`);
  P(`- Provider profiles: ${input.providers.length ? input.providers.map((p) => `${p.id} (${p.type}) ${p.ok ? 'ok' : 'problem'}: ${p.detail}`).join('; ') : 'none configured yet'}.`);
  P('- football-data.org: needs your free API key for verified live status and scores.');
  P();

  P('## 13. Location');
  P();
  P(`\`${dir}\` — outside any Git work tree (checked on every run). Override with \`IPTV_DATA_DIR\`. Credentials: \`provider-profiles/secrets.dpapi.json\`, encrypted with Windows DPAPI for your user; never written to logs, catalogs, playlists or the TV export.`);
  if (input.exportInfo) P(`TV export: \`${input.exportInfo.dir}\` (${Object.keys(input.exportInfo.files).length} files, ${(Object.values(input.exportInfo.files).reduce((a, b) => a + b, 0) / 1048576).toFixed(1)} MB).`);
  P();

  P('## 14. Commands (run in the FBTV folder)');
  P();
  P('- Refresh everything (sources, fixtures, inventory, catalogs, playlists, registry, TV export): `npm run library:refresh`');
  P('- Validate reachability and confirm a sample with ffprobe: `npm run library:validate -- --playable 300`');
  P('- Regenerate registry, catalogs and report from stored data (no network): `npm run library:rebuild`');
  P('- Serve the TV export on your network: `npm run library:serve`');
  P('- Store provider credentials: `npm run library:secret -- set <profile-id>`');
  P();

  P('## 15. Tests and build');
  P();
  P(input.tests || 'Run `npm run check` for typecheck, tests and the app build.');
  P();

  P('## Registry groups (dropdowns)');
  P();
  for (const g of registry.groups) {
    const items = registry.items.filter((i) => i.group === g);
    P(`- **${g}** — ${items.length} item(s): ${items.slice(0, 8).map((i) => `${i.name} (${i.channels})`).join(', ')}${items.length > 8 ? ', …' : ''}`);
  }
  const md = L.join('\n') + '\n';
  writeFileSync(join(dir, 'REPORT.md'), md);
  const summary = {
    generatedAt: new Date().toISOString(),
    dataDir: dir,
    records: records.length,
    statuses: Object.fromEntries(tally(records, (r) => r.status)),
    kinds: Object.fromEntries(tally(records, (r) => r.kind)),
    channels: { live: live.length, playable: live.filter((c) => c.playable).length, radio: channels.length - live.length },
    football: fb.length,
    sports: sports.length,
    vod: input.vod,
    fixtures: fixtures ? fixtures.fixtures.length : 0,
    validation: Object.fromEntries(vals),
    registryItems: registry.items.length,
  };
  writeFileSync(join(dir, 'generated/report.json'), JSON.stringify(summary, null, 2));
  return md;
}
