# Architecture

```
 sources.json ──► Catalogue builder (Node 24, GitHub Actions or local)
   iptv-org API/playlists      fetch (timeouts, size caps) → parse → normalise → overrides
   your M3U URLs               → de-duplicate → filter (blocklist, header-only, DASH/RTMP)
   football provider           → bounded ffprobe sample (resolution/codec, verified date)
   EPG grabber (optional)      → publish compact JSON shards + manifest (hashes)
                                         │  GitHub Pages (CORS *)
                                         ▼
 FBTV on webOS  ── manifest check at start → download changed shards → IndexedDB cache
                   UI (Preact) · focus engine · router · player engine cascade · local prefs
```

The TV never parses megabytes of raw playlists on start-up, never validates streams in the background, and keeps
no API keys. A bundled snapshot lets the first launch work offline.

## Repository layout

```
FBTV/
├─ src/
│  ├─ app/                 webOS app (Vite root)
│  │  ├─ index.html        classic-script shell (rewritten at build, FND-002)
│  │  ├─ main.tsx          boot: polyfills, fonts, styles, focus, input, render
│  │  ├─ App.tsx           route rendering, focus restore, exit dialog
│  │  ├─ focus/            geometry.ts (pure) · engine.ts (DOM) · index.ts (singleton + signal)
│  │  ├─ nav/              router.ts (tabs, pages, overlays, Back order) · input.ts (key dispatcher)
│  │  ├─ platform/         keys.ts · webos.ts (Luna bridge, device info) · storage.ts · capabilities.ts
│  │  ├─ ui/               shared components (TopNav, Shelf, EmptyState, Dialog, Icon, toast)
│  │  ├─ screens/          Home, LiveTV, Movies/Series/Kids, Search, Settings (+ About, Diagnostics)
│  │  ├─ styles/           tokens.css · base.css · components.css · screens.css
│  │  └─ public/icons/     app icons and splash (scripts/make-icons.py)
│  ├─ shared/              code shared by the app and the builder (parsers, model, search) — from v0.3.0
│  ├─ builder/             catalogue builder — from v0.3.0
│  └─ tools/               pure helpers for scripts (changelog.ts)
├─ tests/                  Vitest (jsdom) unit tests
├─ scripts/                package.mjs · deploy.mjs · release.mjs · make-icons.py · lib/
├─ config/                 sources.json, overrides — from v0.3.0
├─ docs/                   this folder
├─ fbtv.config.json        app id, title, catalogue URL
├─ CHANGELOG.md · LICENSE · THIRD_PARTY.md · README.md
└─ releases/               built IPKs (git-ignored; attached to GitHub Releases)
```

## App runtime

- **Stage.** The UI is laid out at exactly 1920×1080 (`appinfo.json` `resolution`). In a desktop browser the stage
  is scaled to fit the window; on the TV the scale is 1.
- **Focus.** Elements opt in with `data-focusable`. The engine picks the next element geometrically (nearest row
  first for Up/Down, same row first for Left/Right), searching the innermost scroll container first. Groups can
  remember their last child (`data-focus-memory`) or name an entry child (`data-focus-enter`). Dialogs are traps.
  Geometry uses layout offsets minus scroll tracks' target translation, so it is stable during animations.
- **Scrolling.** Scroll viewports (`data-scroll="x|y"`) translate their track with a CSS transform
  (GPU-composited) to keep the focused element (or its `data-scroll-anchor`) visible.
- **Input.** One `keydown` listener maps remote/keyboard codes to actions. Screen handlers (e.g. the player) get
  first refusal; directions go to the engine, OK clicks the focused element, Back goes to the router.
- **Back order.** Overlay → page → nav bar → Home → "Exit FBTV?" (default: Stay).
- **State.** Preact signals for navigation; localStorage (prefixed, guarded) for small preferences; IndexedDB for
  the catalogue cache (v0.3.0).
- **Platform.** Luna calls go through the built-in `PalmServiceBridge` (no webOSTV.js). `requiredACG` lists only
  what is used (`systemconfig.query`).

## Compatibility floor

webOS 4.x (Chromium 53) and newer. Syntax is lowered to ES2015 at build time; a few runtime APIs are polyfilled
(`Object.entries/values/fromEntries`, `Array.prototype.flat/flatMap`, `String.prototype.padStart`,
`Promise.prototype.finally`). CSS avoids features newer than Chromium 53 (FND-001).
