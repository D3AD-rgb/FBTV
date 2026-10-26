# Changelog

All notable changes to FBTV are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).

Each release section is also the message of its annotated git tag (`git show vX.Y.Z`), lists the commits it
contains, and references bug/finding IDs from [docs/FINDINGS.md](docs/FINDINGS.md). See
[docs/versioning.md](docs/versioning.md) for the workflow.

## [Unreleased]

### Added
- Player engine layer: native webOS HLS (via `<source>`), hls.js and mpegts.js over MSE, loaded on demand from
  `vendor/`; engine order per stream type, remembered engine per URL, start-up timeout, supersede on fast switching.
- Playback error classification with plain-language messages (needs headers, forbidden/geo, not found, CORS,
  decode, timeout, unsupported format/protocol).
- Playback test screen (Settings › Playback test, Diagnostics › Run playback test): plays public vendor test
  streams (Mux, Akamai, Apple) with each engine and records resolution, start-up time and audio tracks.

### Findings
- FND-008: target TV is an LG 50UQ751C0LF on webOS TV 22 (Chromium 87).
- FND-009: Key Server can appear on while not listening; toggle it to fetch the key.

### Changed
- Packaging: builds that are not exactly a tagged release are named
  `<app-id>_<version>-dev.<commit>[.dirty]_all.ipk`, so they never overwrite a release IPK; `npm run deploy`
  installs the newest package unless `--ipk` is given.

### Fixed
- Release tags lost their markdown headings because git strips `#` lines from tag messages (BUG-004).

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

[Unreleased]: https://github.com/D3AD-rgb/FBTV/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/D3AD-rgb/FBTV/releases/tag/v0.1.0
