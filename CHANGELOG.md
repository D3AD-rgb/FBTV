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

### Findings
- FND-012: imgur blocks UK viewers with a placeholder logo; non-imgur logos preferred, placeholder detected.
- FND-013: emoji flags are not reliable on TVs; country names and code badges are used.
- FND-014: first full catalogue build numbers.

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
