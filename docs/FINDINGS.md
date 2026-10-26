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
| FND-004 | Platform | v0.1.0 | Note | — | Developer Mode sessions expire after ~50 hours and sideloaded apps are removed. Extend in the Developer Mode app; `npm run deploy` prints a reminder. |
| FND-005 | Data | v0.1.0 | Note | — | iptv-org uses country code `UK` (not ISO `GB`): channel ids end in `.uk` and the playlist is `countries/uk.m3u`. Normalisation must map both. |
| FND-006 | Data | v0.1.0 | Note | — | iptv-org stream `quality` is self-reported by submitters (only 21 streams claim 2160p). A 4K badge requires our own ffprobe measurement. |
| FND-007 | Data | v0.1.0 | Note | — | 726 iptv-org entries need a custom User-Agent or Referer, which the webOS `<video>` element cannot send. They are excluded and labelled rather than proxied. |
| BUG-001 | Bug | v0.1.0 | Fixed | v0.1.0 | Focus became invisible after switching tabs: Preact rewrote the `class` attribute and removed the engine's `is-focused` class. Focus is now marked with a `data-focused` attribute that components never render. |
| BUG-002 | Bug | v0.1.0 | Fixed | v0.1.0 | Right with a hidden next card jumped diagonally to the row below. Left/Right now stays on the current row whenever a candidate lines up. |
| BUG-003 | Bug | v0.1.0 | Fixed | v0.1.0 | Up from the first shelf skipped the hero (scrolled behind the nav bar) and landed in the nav. Candidate search now starts in the innermost scroll container and widens outward. |
