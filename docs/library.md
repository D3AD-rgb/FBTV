# Source library

The source library is built on the PC from every source the project inspects. It is the data the
TV's Live TV, Football and Sports screens are generated from. It lives **outside the repository**
and is never committed or published.

## Where it lives

`IPTV_DATA_DIR`, or `../FBTV-local-data` next to the repository by default. The tool refuses a
folder inside any Git work tree.

```text
FBTV-local-data/
  repositories/<repo>/…        originals, byte for byte (blobless shallow snapshots + remote files)
  manifest.json                every file: origin, commit, SHA-256, licence, permission, status, reason
  catalogs/inventory.jsonl     one record per entry discovered, with status and reasons (Layer A)
  catalogs/*.json              channels, football, sports, fixtures, movies, series, VOD review
  playlists/…                  generated M3U lists (live-tv by country/language/category/source,
                               news, sports, football, combined, movies-vod, series-vod)
  source-registry.json         every list with counts, languages, attribution and validation
  provider-profiles/           your own M3U / Xtream profiles (no credentials in these files)
  generated/                   provider and validation state, report.json
  logs/                        one log per day
  REPORT.md                    the collection report with real counts
```

## Commands

| Command | What it does |
|---|---|
| `npm run library:refresh` | Collect all sources → providers → inventory → fixtures → catalogs → TV export → report |
| `npm run library:refresh -- --only openfootball` | Refresh only the named repositories (comma list); others keep their last snapshot |
| `npm run library:refresh -- --offline` | Rebuild from stored snapshots without network access |
| `npm run library:rebuild` | Inventory → catalogs → export → report from stored data |
| `npm run library:fixtures` | Refresh fixtures only (openfootball files already collected + TheSportsDB); `-- --offline` reuses stored responses |
| `npm run library:validate -- --limit 4000 --playable 300` | Check reachability (polite: 2 requests per host) and confirm playback with ffprobe |
| `npm run library:export` / `library:serve` | Write the TV export / serve it read-only on the home network (port 8787) |
| `npm run library:secret -- set <profile-id>` | Store a provider's username and password, encrypted with Windows DPAPI |
| `npm run library:xtream -- test <profile-id>` | Detect an Xtream provider's capabilities |
| `npm run library:report` | Rewrite REPORT.md |

## Nothing is dropped silently

Every entry gets a status and, unless imported, a reason:

| Status | Meaning |
|---|---|
| `imported` | Usable entry the TV can attempt |
| `duplicate_reference` | Same stream already imported from a more trusted source; kept as provenance |
| `unsupported_format` | RTP/RTSP/UDP/RTMP, MPEG-DASH, or needs headers the TV player cannot send |
| `requires_provider_access` | Only reachable inside an ISP or local network |
| `restricted` | Pay-TV relay, leaked hotel gateway or token-protected list: recorded with name, source and line, **URL withheld** |
| `reference_only` | Template, alias or resource-list entry without a stream |
| `malformed` | A line the parser could not read (kept with its line number) |
| `test_fixture` | Test playlists shipped inside a repository |

Validation adds `untested`, `reachable`, `temporarily_unavailable`, `playback_confirmed` or
`playback_failed`. Nothing is shown as working unless it was checked.

## Provider profiles

Copy an entry from `provider-profiles/profiles.example.json` into `profiles.local.json`, set
`enabled: true`, then store credentials with `npm run library:secret -- set <id>` (you type them at
a hidden prompt). Credentials are encrypted with Windows DPAPI for your Windows account and never
written to profiles, manifests, logs, reports or the TV export. An unconfigured provider is shown
as "needs credentials", never as connected.

On-demand items: everything a provider lists is kept for review (Layer A); the Movies and Series
lists show English, Hindi and Bengali by language metadata (Layer B).

## Fixtures

- **openfootball** (public domain): full seasons for the Premier League, Championship, La Liga,
  Serie A, Bundesliga, Ligue 1, Eredivisie and Primeira Liga (JSON), the Scottish, Turkish, Greek,
  Swiss, Belgian and Austrian leagues, the Brasileirão and Copa Libertadores (Football.TXT), and the
  2026 World Cup.
- **TheSportsDB** (free key): Champions League, Europa League, Conference League, FA Cup, EFL Cup,
  Copa del Rey, DFB-Pokal, Coppa Italia, Coupe de France, Nations League, Saudi Pro League, MLS,
  Argentina, F1, MotoGP, WRC, NBA, NFL, MLB, NHL, UFC and IPL. Whole rounds around now are fetched,
  plus TV listings for the biggest upcoming matches. The free key is heavily throttled (FND-017), so
  a refresh takes a while; responses are cached for 3 hours, so an interrupted run resumes.

Fixtures are schedules only. "Started" means the kick-off time has passed; live status and scores
need a live data source (football-data.org key, not configured). A TV listing is third-party data
and never implies a stream.

## Broadcasters

`config/broadcasters/<competition>.json` lists, for each competition, the rights holders in every country the
research found (official league, UEFA and broadcaster pages first), each entry with its source URL and the date
it was checked. On the TV, match, competition and sport pages show them by country (home country first) with
free-to-air channels marked. A broadcaster links to a library channel only when a channel of the same name and
country has a public stream; paid channels are listed, never linked to unofficial relays. Rights data says who
may show a competition, not which channel shows a particular match.

## Followed clubs

Manchester City is followed by default. Follow any club from Live Football › My clubs › Follow clubs, or from a
match page. Each followed club gets its own section at the top of Live Football (every match in every
competition, plus its club TV), and Live TV gets a "★ <club>" source.

## On demand

- **Internet Archive** (`internet-archive` source): items marked public domain, only when credible: release year
  1977 or earlier (English) / 1965 or earlier (Hindi, Bengali), no rip or release tags in the title, undated
  items only from curated collections, no adult content (FND-022). One metadata lookup per item finds its H.264
  MP4; lookups are cached in `repositories/internet-archive/meta/`. Refresh with
  `npm run library:refresh -- --only internet-archive --no-fixtures`.
- **Your providers**: Xtream or VOD M3U profiles you are entitled to use.
- Unlicensed VOD sites and scraper playlists (YTS, TMDB-To-VOD-Playlist) are not used.

## Getting it onto the TV

The TV cannot read the PC's folders. Two ways:

1. **Local build:** `npm run package -- --with-library` bundles the export into an IPK named
   `…-local.<commit>…`, then `npm run deploy`. Install it on your own TV only.
2. **Home-network server:** `npm run library:serve` on the PC, then enter the printed
   `http://<pc-ip>:8787/registry.json` in Settings › Sources on the TV. The TV reloads the library
   without a reinstall.

Public and release builds never contain the library.
