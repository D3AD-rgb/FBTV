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
  playlists/source-playlists/<collection>/   one normalised M3U per source playlist file
  playlists/custom/            your selection and named playlists, rebuilt from settings/playlists.json
  playlists/my-playlist/       yours: put your own M3U files here (never touched by a build)
  playlists/custom-user/       yours: anything you want kept (never touched by a build)
  media/movies|series|other/   your own video files, with sidecar subtitles and artwork
  settings/playlists.json      selections and named playlists saved from the TV (+ .bak)
  source-registry.json         every list with counts, languages, attribution and validation
  provider-profiles/           your own M3U / Xtream profiles (no credentials in these files)
  generated/                   provider and validation state, report.json, private play tokens
  manifests/generated-files.json   every file the last build wrote (cleanup works from this)
  reports/cleanup*.md          what the last cleanup removed, or would remove
  backups/                     copies taken before changes to your files
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
| `npm run library:export` | Write the TV export (to a staging folder; the previous export stays if anything fails) |
| `npm run library:serve` | Serve the export, your media and your playlist settings on the home network (port 8787; `-- --port N --host <ip>`) |
| `npm run library:cleanup -- --dry-run` | Rebuild and list the outdated generated files a cleanup would remove (nothing deleted); without `--dry-run` it removes them |
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

Validation adds `untested` (not yet checked), `reachable` (the server answered), `format_recognised`
(the answer is HLS, MPEG-TS, MP4 or FLV), `playback_confirmed` (ffprobe found audio/video),
`temporarily_unavailable` or `playback_failed`. Nothing is shown as working unless it was checked, and
a failed check never removes a source.

## Provider profiles (My Playlist)

Copy an entry from `provider-profiles/profiles.example.json` into `profiles.local.json`, set
`enabled: true`, then store credentials with `npm run library:secret -- set <id>` (you type them at
a hidden prompt). An M3U profile takes a `url` or a `file`; a relative `file` is inside the data
folder, so `"file": "playlists/my-playlist/mine.m3u"` works. Every enabled profile appears on the TV
under **My Playlist**. Its addresses never leave the PC: the TV export carries `@play/<token>` and
`@xtream/…` references that only the library server resolves, so My Playlist plays when the TV reads
the library from the PC (not from the copy bundled into the app). Credentials are encrypted with Windows DPAPI for your Windows account and never
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

## Playlists on the TV

The Playlists tab lists every source playlist file, grouped into collections that keep their identity:
My Playlist, the nine supplied repositories (iptv-org/iptv, lizongying/my-tv, imDazui/Tvlist-awesome-m3u-m3u8,
fanmingming/live, Guovin/iptv-api, laoma528/awesome-zhuiju-free, iptv-org/awesome-iptv with Free-TV,
HerbertHe/iptv-sources, 4gray/iptvnator), then jromero88/iptv and the Internet Archive. Category sections
(Live TV, Sports, Football, Cricket, Tennis, Motorsport, Combat, Countries, Languages, 4K, News, Movies,
Series, Radio) appear only when they have playlists.

- **Browse and preview:** each playlist shows entries, playable, withheld, unsupported and error counts and
  validation; the preview lists its first entries.
- **Select** with Red (or the Select button), **Select all** / **Clear** for the section, **Save selection** /
  **Restore**, **Combine selected…** into a named playlist, **Green** to add a playlist to one of yours,
  **Yellow** rename, **Blue** delete (your playlists only; the sources stay).
- **Watch** opens a playlist (or the whole selection) in Live TV; in an opened playlist, OK plays an entry,
  falling back to its other addresses.
- Playlist ids depend only on the source and file, so selections survive refreshes and rebuilds. Your
  selections are kept on the TV and, in server mode, saved to `settings/playlists.json` on the PC; a
  rebuild writes them as M3U files in `playlists/custom/` (a member that disappeared is reported, never
  removed from your definition).

Some collections cannot play by design: lizongying/my-tv lists channels without addresses, awesome-zhuiju-free
lists websites, iptvnator only has test files. Withheld entries (paid relays, hotel gateways, URLs carrying
another person's login) are shown by name with the reason and no link.

## Your own media

Put video files in `media/movies`, `media/series/<Show>/Season N` and `media/other`, then
`npm run library:rebuild`. Names like `Heat (1995).mp4`, `Show S01E02.mkv` or `Show 1x02.mkv` give the title,
year, season and episode; `<name>.en.srt` / `.vtt` next to a file are its subtitles; `poster.jpg`,
`folder.jpg`, `cover.jpg` or `<name>.jpg` its artwork. On the TV, Movies and Series start with **On your PC**:
continue watching, recently watched, favourites, films A–Z and series by season. The player resumes where you
stopped, skips 30 s with ◀◀/▶▶ and turns subtitles on and off. Search covers your files too.

The TV export only has ids, names and sizes: the files are streamed by `library:serve` by id (with byte
ranges, so seeking works), and `.srt` is converted to WebVTT on the fly. No path leaves the PC.

## Safe refresh and cleanup

Each build records the files it wrote in `manifests/generated-files.json`. A later build removes only files
that an earlier build recorded, that it no longer writes, and that are inside its own folders (`playlists/`,
`catalogs/`, `generated/`), never `playlists/my-playlist/`, `playlists/custom-user/` or `generated/profiles/`.
Original repository files, media, profiles, credentials, settings and anything you put there yourself are
never removed. `npm run library:cleanup -- --dry-run` lists what would go in `reports/cleanup-dry-run.md`.

The TV export is written to a staging folder and swapped in only when complete; the previous export is kept as
`library-export.previous`, and a failed build leaves the current one in place.

## Getting it onto the TV

The TV cannot read the PC's folders. Two ways:

1. **Local build:** `npm run package -- --with-library` bundles the export into an IPK named
   `…-local.<commit>…`, then `npm run deploy`. Install it on your own TV only.
2. **Home-network server:** `npm run library:serve` on the PC. A local build already knows the PC's
   address (recorded when it was packaged, in `library/server.json`) and uses the server whenever it
   answers, falling back to the bundled copy after 4 seconds; nothing has to be typed on the TV. If the
   PC's address changes, enter the new `http://<pc-ip>:8787/registry.json` in Settings › Sources (or
   repackage). The TV reloads the library without a reinstall. This is the mode that plays My Playlist,
   provider films and your own media, and saves playlist selections on the PC.

The server binds to the PC's home-network address, answers only private-network and loopback clients
(anything else gets 403), serves only the export's JSON files, media by id, private play tokens and the
playlist settings file (validated, 512 KB maximum), and never lists folders or reveals paths, profiles or
credentials. Do not forward its port on your router.

Public and release builds never contain the library.

## Always-on server (cloud VM)

So the PC does not have to stay on, the library can live on an always-on Linux VM (an Oracle Cloud
free VM works) that builds it from the same public sources:

1. `ssh <user>@<vm> 'bash -s' < scripts/vm/setup.sh` installs Node (checksum-verified), the code, an
   access key (`~/FBTV-local-data/settings/server-key`), the server on `127.0.0.1:8787`
   (`fbtv-library.service`), a nightly refresh (`fbtv-refresh.timer`, 04:30 UK time) and a weekly stream
   check (`fbtv-validate.timer`). Run it again to update.
2. Publish it over HTTPS with Tailscale Funnel, on the VM:
   `sudo tailscale funnel --bg --https=443 http://127.0.0.1:8787` (the first time, Tailscale asks you to
   allow Funnel for the machine). No firewall port is opened on the VM.
3. Package with the VM first: put `https://<vm>.<tailnet>.ts.net/k/<key>/registry.json` in a file and run
   `npm run package -- --with-library --library-server-file <file>`. The TV tries the VM, then the PC at
   home, then the bundled copy.

Every address must carry the access key (`/k/<key>/`); anything else gets "not found". The key is never
printed in logs or shown on the TV, and is never committed. The server name is public (HTTPS certificate
logs), so the key is what protects it: to change it, delete the key file, run the setup script again and
repackage. Videos never pass through the VM: it serves lists and redirects; the TV fetches streams from
their sources. Provider credentials are encrypted with DPAPI on Windows only; on Linux they are kept in a
file readable only by the VM's user (`npm run library:secret -- set <id>` on the VM).
