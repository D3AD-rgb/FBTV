# Findings and bugs

Numbered log of bugs (`BUG-###`) and findings (`FND-###`: platform facts, data quirks, decisions forced by
evidence). Reference the ID in commit messages and changelog entries, e.g. `fix(nav): keep focus marker (BUG-001)`.

`Found in` / `Fixed in` hold a tag. Write `Unreleased` while work is in progress; `npm run release` replaces it
with the new tag automatically.

| ID | Type | Found in | Status | Fixed in | Summary |
|---|---|---|---|---|---|
| FND-001 | Platform | v0.1.0 | Workaround | v0.1.0 | CSS flex `gap`, `inset`, `aspect-ratio`, `clamp()`, `:is()`, `:focus-visible` and `backdrop-filter` are unavailable on older webOS engines (webOS 4 = Chromium 53, flex gap needs Chromium 84). Styles use margins (`.hstack`/`.vstack`) and explicit sizes. |
| FND-002 | Platform | v0.1.0 | Workaround | v0.1.0 | Packaged apps load from `file://`: module scripts are blocked and every fetch is subject to CORS. Build emits one classic deferred IIFE bundle; data endpoints must send `Access-Control-Allow-Origin`. |
| FND-003 | Platform | v0.1.0 | Workaround | v0.1.0 | `ares-package` warns when `requiredACG` is missing (enforced from webOS 26/27). Declared `systemconfig.query` for the `getSystemInfo` call used by Diagnostics. |
| FND-004 | Platform | v0.1.0 | Note | — | Developer Mode sessions expire and sideloaded apps are removed when they do. The owner's TV showed a 999-hour session (docs often quote ~50 h). Extend in the Developer Mode app; `npm run deploy` prints a reminder. |
| FND-005 | Data | v0.1.0 | Note | — | iptv-org uses country code `UK` (not ISO `GB`): channel ids end in `.uk` and the playlist is `countries/uk.m3u`. Normalisation must map both. |
| FND-006 | Data | v0.1.0 | Note | — | iptv-org stream `quality` is self-reported by submitters (only 21 streams claim 2160p). A 4K badge requires our own ffprobe measurement. |
| FND-007 | Data | v0.1.0 | Note | — | 726 iptv-org entries need a custom User-Agent or Referer, which the webOS `<video>` element cannot send. They are excluded and labelled rather than proxied. |
| BUG-001 | Bug | v0.1.0 | Fixed | v0.1.0 | Focus became invisible after switching tabs: Preact rewrote the `class` attribute and removed the engine's `is-focused` class. Focus is now marked with a `data-focused` attribute that components never render. |
| BUG-002 | Bug | v0.1.0 | Fixed | v0.1.0 | Right with a hidden next card jumped diagonally to the row below. Left/Right now stays on the current row whenever a candidate lines up. |
| BUG-003 | Bug | v0.1.0 | Fixed | v0.1.0 | Up from the first shelf skipped the hero (scrolled behind the nav bar) and landed in the nav. Candidate search now starts in the innermost scroll container and widens outward. |
| BUG-004 | Bug | v0.1.0 | Fixed | Unreleased | Annotated release tags lost the changelog's `##`/`###` headings: `git tag -F` strips lines starting with `#` by default. The release script now passes `--cleanup=verbatim`; the v0.1.0 tag was re-created before publishing. |
| FND-008 | Platform | Unreleased | Note | — | Target TV: LG 50UQ751C0LF (2022 UQ75, 4K panel, board K8LP_DVB_EU), webOS TV 22 (SDK 7.6.0, firmware 04.60.91) → Chromium 87 engine. Paired over Wi-Fi at port 9922. |
| FND-009 | Tooling | Unreleased | Workaround | — | The Developer Mode Key Server (port 9991) can show as on while not listening; `ares-novacom --getkey` then fails with "Failed to get ssh private key". Toggling Key Server off and on fixes it. Device config and the TV key live in the user profile (`%APPDATA%\.webos	v`, `~/.ssh/tv_webos`), so ares commands must run in the user's own shell. |
| FND-010 | Platform | Unreleased | Note | — | Playback test on the target TV (webOS 22): the native player plays classic HLS with MPEG-TS segments and H.264/AAC and starts fastest (2.8 s vs 8.8 s for hls.js), but rejects Apple's fMP4 HEVC/Dolby Vision master playlist; hls.js plays that stream at a measured 3840×2160 with 2 audio tracks. Keeps the default order native → hls.js; a native `<source>` rejection gives no reason, so it is reported as `rejected` and the next engine is tried. |
| FND-011 | Data | Unreleased | Fixed | Unreleased | The Akamai public live test channel is broken upstream (master 200, only variant 404), so it failed on both engines. Replaced in the playback test by Unified Streaming's live demo (verified 2026-10-26). |
