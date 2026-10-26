# Changelog

All notable changes to FBTV are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

Each release section is also the message of its annotated git tag (`git show vX.Y.Z`), lists the commits it
contains, and references bug/finding IDs from [docs/FINDINGS.md](docs/FINDINGS.md). See
[docs/versioning.md](docs/versioning.md) for the workflow.

## [Unreleased]

### Added
- Catalogue builder (`npm run catalogue`, `npm run catalogue:probe`): fetches configured sources politely
  (timeouts, size caps, conditional requests, retries), normalises and de-duplicates iptv-org channels, feeds,
  streams and logos, adds your own M3U playlists, applies `config/overrides.json` and the Kids allow/block lists,
  drops blocklisted/closed/NSFW channels and streams the TV cannot play, and publishes compact JSON shards with a
  hashed manifest (FND-014). Each source is isolated; failures are reported, not fatal.
- Bounded stream verification with ffprobe: a capped, rotating sample per run (home country and preferred
  language first) records measured resolution, codecs and online status.
- Shared, tested modules: defensive M3U parser, metadata normalisation (country UK/GB, ISO 639-3 languages,
  advertised vs verified quality, sport tags, kids eligibility), stream fingerprints, URL validation, search
  index (prefix, typo tolerance, abbreviations such as EPL/UCL/UK), collection rules, catalogue wire codec.
- On the TV: catalogue loading (cache → bundled snapshot → background update from a published manifest),
  favourites (Red key) and recently watched, stable channel numbers (favourites 1…N, home country from 101).
- Live TV deck with list chips (All, Favourites, Recently watched, UK TV, News, Sports, Kids, Movie and Series
  channels, 4K, Checked online, Countries), live preview after a pause, channel details and a windowed list.
- Full-screen player: Up/Down and CH± switching with a banner, number entry, last channel (Blue), favourite
  (Red), channel list overlay, audio track cycling, automatic fallback to the channel's other feeds, retry and
  plain-language errors.
- Countries (every country in the catalogue, search by name or code) and country pages by category; UK TV,
  News, Sports, Kids, 4K (verified vs advertised), Movie and Series channel collections; Home shelves and a
  "continue watching" hero; search over channels, countries, languages, categories and collections.
- Local source library (`npm run library:refresh`), kept outside Git in `IPTV_DATA_DIR` (default
  `../FBTV-local-data`): inspects all nine source repositories plus Free-TV and openfootball, stores every
  usable file with its origin, commit, SHA-256, licence and permission, and records everything else as a
  reference with the reason. Nothing is dropped silently: every entry gets a status (imported, restricted,
  unsupported_format, requires_provider_access, malformed, test_fixture, duplicate_reference, …) and pay-TV
  relays, hotel lists and token-protected lists are inventoried with their URL withheld.
- Library catalogs and playlists: channels grouped across sources with all alternative streams; M3U lists by
  country, language, category and source; News, Sports (per sport) and Football (dedicated, club TV,
  broadcaster brands, English, Arabic) lists; Radio; reachable and playback-confirmed lists; a registry of
  every list with counts and validation status.
- Provider profiles for your own M3U and Xtream accounts, with secrets protected by Windows DPAPI
  (`npm run library:secret set <id>`), capability detection and VOD/series import (English, Hindi and Bengali
  shown; everything kept for review). Credentials never enter manifests, logs, reports or the TV export.
- Fixtures: full seasons from openfootball for 15 leagues (Premier League, Championship, La Liga, Serie A,
  Bundesliga, Ligue 1, Eredivisie, Primeira Liga, Scottish Premiership, Süper Lig, Greek Super League, Swiss
  Super League, Belgian Pro League, Austrian Bundesliga, Brasileirão), Copa Libertadores 2026 and the 2026
  World Cup, with Football.TXT support; TheSportsDB for the Champions League, Europa League, Conference League,
  domestic cups, more leagues and other sports, plus TV listings for the biggest upcoming matches. Every
  competition id is verified by name; unanswered lookups are retried, never treated as a match.
- TV export and home-network sync: `npm run library:refresh` writes a compact export that is bundled into the
  app; `npm run library:serve` serves it read-only on the home network so the TV can update without a reinstall
  (Settings › Sources).
- Live Football tab: started, today and top matches this week ordered by competition tier and bigger clubs, a
  shelf per competition, latest results, competition pages by round, match pages with third-party TV listings
  and name-matched library channels marked unverified, and football channels by role. "Started" means the
  kick-off time has passed; live status and scores are never claimed without a live data source.
- Sports tab: F1 and motorsport, rally, NBA, cricket, UFC and MMA, boxing, wrestling, tennis, golf, rugby, NFL,
  MLB, NHL and more, each with upcoming events and every tagged channel (playable first, unavailable kept and
  labelled).
- Live TV source dropdown generated from the library registry ("Sources ▾") with quick chips (UK, English
  News, Sports, Football, Bangladesh, India, Radio, All); rows show each channel's last-check status and why
  an unavailable channel cannot play. Favourites and history resolve across the catalogue and the library.

- Where to watch: every match card shows the UK service ("Sky Sports", "TNT Sports / Prime Video?" when not yet
  assigned, "Not on UK TV (3pm)" for the Saturday blackout); match pages explain it and offer "Watch on" buttons that
  open the official app (NOW, HBO Max for TNT Sports, Prime Video, BBC iPlayer, ITVX, DAZN, …) when installed; each
  followed club gets a "next 30 days" summary of which services its matches need. Diagnostics lists the apps found.
- Followed clubs: Manchester City by default, any club from any competition in "Follow clubs". Each followed club
  gets its own section at the top of Live Football with every match across all competitions and its club TV, a
  "★ Manchester City" source in Live TV (club TV plus rights holders of its next matches with a public stream),
  and Follow buttons on match pages.
- All matches: every football fixture in the library by date, starting at the next match, with a My clubs filter.
- Broadcasters for every match: rights holders by country (worldwide) for each competition, researched from
  official league, UEFA and broadcaster sources and stored with their sources in `config/broadcasters/`. Match,
  competition and sport pages list them with free-to-air channels marked, and a Watch now shelf plays any rights
  holder whose own public stream is in the library. Paid broadcasters are listed, never linked to unofficial relays.
- On demand in Bengali, English and Hindi: public-domain feature films and classic TV series from the Internet
  Archive (only items whose year and title make the public-domain mark credible, FND-022), arranged by language and
  genre, with series pages listing every episode.
- Clearstream (killerwaz/clearstream, MIT) added as a source of legitimacy rules: restream hosts, official free
  platforms, paid sports brands and extra cricket/football tags.
- jromero88/iptv added to the library (resold relays withheld, home-tuner entries marked LAN-only, Internet
  Archive episodes kept with rights unverified).
- Playlists tab: every source playlist file (694 today) in collections that keep their identity — My Playlist, the
  nine supplied repositories, jromero88/iptv and the Internet Archive — plus category sections shown only when
  they have data (Live TV, Sports, Football, Cricket, Tennis, Motorsport, Combat, Countries, Languages, 4K, News,
  Movies, Series, Radio). Search, preview with counts and validation, select (Red), select all, clear, save and
  restore a selection, combine selected playlists into a named playlist, add (Green), rename (Yellow), delete
  (Blue), watch a playlist or the whole selection in Live TV, and OK plays an entry with fallback to its other
  addresses. Stable playlist ids keep selections across refreshes; in server mode they are saved on the PC
  (`settings/playlists.json`) and rebuilt as M3U files in `playlists/custom/`.
- Your own media: `media/movies`, `media/series`, `media/other` on the PC are indexed (title, year, season,
  episode, sidecar subtitles, artwork) and shown as "On your PC" in Movies and Series (continue watching, recently
  watched, favourites, films, series by season) and in Search. Files stream from `library:serve` by id with byte
  ranges; `.srt` subtitles are converted to WebVTT.
- Player: on-demand items (your media, Internet Archive films and episodes, provider films) resume where you
  stopped, show a position bar, skip 30 s with ◀◀/▶▶ (buttons and remote keys) and switch sidecar subtitles.
- My Playlist addresses (provider profiles) never leave the PC: the export carries `@play/<token>` references
  resolved by the library server. A relative profile `file` is read from the data folder.
- Validation state "format recognised" (HLS, MPEG-TS, MP4 or FLV answer) between "reachable" and "playback
  confirmed".
- Safe refresh: every build records its files in `manifests/generated-files.json` and later removes only outdated
  files it recorded inside its own folders; `npm run library:cleanup -- --dry-run` previews that. The TV export is
  staged and swapped in only when complete, keeping the previous one.
- Library server: binds to the home-network address, answers private-network clients only, serves media by id,
  play tokens and the validated playlist settings file, and never exposes paths or credentials.

### Findings
- FND-012: imgur blocks UK viewers with a placeholder logo; non-imgur logos preferred, placeholder detected.
- FND-013: emoji flags are not reliable on TVs; country names and code badges are used.
- FND-014: first full catalogue build numbers.
- FND-015: "VOD" group names and `.flv` URLs are live channels; on demand now needs a duration or a media file.
- FND-016: LyngSat answers hotlinked logos with a placeholder; those logos are skipped.
- FND-017: TheSportsDB free-key limits (one event per next/past, full rounds via `eventsround`) and its much
  tighter throttle; unanswered lookups are retried instead of being reported as wrong ids.
- FND-018: club-name matching produced football false positives; limited to sports channels.
- FND-019: the cymz6 hotel list upstream returns 404.
- FND-020: openfootball coverage for 2026-27 (no European cups; Football.TXT leagues; undated Belgian rounds).
- FND-021: club names differ between providers; fixtures are merged by name tokens, dates and round, not duplicated.
- FND-022: Internet Archive public-domain marks are often false for recent Indian films; strict credibility rules.
- FND-023: resold paid-IPTV URLs carry account credentials; withheld everywhere.
- FND-024: paid sports channels withheld from every source (Clearstream's rule); only free-to-air rights holders are linked.
- FND-025: build outputs used to be pruned by sweeping folders; ownership is now tracked in a manifest.
- BUG-005: Up from the top of a Playlists list jumped to the preview column instead of the header.

## [0.2.0] - 2026-10-26

### Added
- Player engine layer: native webOS HLS (via `<source>`), hls.js and mpegts.js over MSE, loaded on demand from
  `vendor/`; engine order per stream type, remembered engine per URL, start-up timeout, supersede on fast switching.
- Playback error classification with plain-language messages (needs headers, forbidden/geo, not found, CORS,
  decode, timeout, unsupported format/protocol, and `rejected` when the TV player refuses a source without a
  reason).
- Playback test screen (Settings › Playback test, Diagnostics › Run playback test): plays public vendor test
  streams (Mux, Unified Streaming, Apple) with each engine and records resolution, start-up time and audio tracks.

### Findings
- FND-010: native player handles TS-segment HLS fastest; hls.js plays fMP4 HEVC 4K that native rejects.
- FND-011: Akamai live test channel broken upstream; replaced with Unified Streaming's live demo.
- FND-008: target TV is an LG 50UQ751C0LF on webOS TV 22 (Chromium 87).
- FND-009: Key Server can appear on while not listening; toggle it to fetch the key.

### Changed
- Packaging: builds that are not exactly a tagged release are named
  `<app-id>_<version>-dev.<commit>[.dirty]_all.ipk`, so they never overwrite a release IPK; `npm run deploy`
  installs the newest package unless `--ipk` is given.

### Fixed
- Release tags lost their markdown headings because git strips `#` lines from tag messages (BUG-004).

### Commits

- docs: correct test stream list in changelog (ba1c057)
- fix(player): report native source rejection honestly; replace broken live test stream (5e0261e)
- chore: correct release and deploy hints (f6803e2)
- build: name untagged builds as dev packages; deploy newest (99fccae)
- docs: record target TV details and Key Server quirk (FND-008, FND-009) (51063d9)
- feat(player): engine cascade and on-TV playback test (b3e1ba4)
- fix(release): keep markdown headings in annotated tag messages (BUG-004) (105c29f)

## [0.1.0] - 2026-10-26

### Added
- Project foundations: Vite build emitting a single classic-script bundle for webOS `file://` (FND-002),
  ES2015 output with polyfills for webOS 4 and newer, `appinfo.json` generated from `package.json`.
- Design system tokens (palette, type scale, spacing, card sizes, focus ring) with Chromium 53-safe CSS (FND-001).
- Spatial-navigation focus engine: nearest-row geometry, row/page scroll tracks, focus memory, entry rules,
  traps for dialogs, boundaries and overrides.
- Remote handling: arrows, OK, Back (461), CH+/−, digits, colour and media keys, Magic Remote pointer.
- Router with Back order: overlay → page → nav bar → Home → exit prompt.
- App shell: top navigation (Home, Live TV, Movies, Series, Kids, Search, Settings) with honest empty states.
- Diagnostics screen: device model and webOS version (Luna `getSystemInfo`), media format support
  (`canPlayType`, MSE), platform features.
- App icons and splash screen.
- Scripts: `npm run package` (ares-package, with SHA-256), `npm run deploy` (ares-install + ares-launch),
  `npm run release` (version, changelog, findings, annotated tag, IPK).
- Documentation: research of the nine source repositories, architecture, decisions, design system, remote map,
  deployment guide, findings log.

### Fixed
- Focus marker lost when a component re-rendered (BUG-001).
- Left/Right jumping diagonally to another row (BUG-002).
- Up skipping content scrolled behind the nav bar (BUG-003).

### Commits

- docs: source research, architecture, decisions and deployment guide (764492c)
- build: package, deploy and release scripts (c2ad5c2)
- feat(app): design system, app shell and Diagnostics (fea6f96)
- feat(nav): spatial focus engine, router and remote input (94d8597)
- chore: scaffold FBTV project (3be0169)

[Unreleased]: https://github.com/D3AD-rgb/FBTV/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/D3AD-rgb/FBTV/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/D3AD-rgb/FBTV/releases/tag/v0.1.0
