# Decision records

Short records of decisions that shape the build. Superseded decisions stay, marked as such.

## ADR-001 · UI direction: Google TV shell + Live deck (2026-10-25, accepted)
Home, Movies, Series, Kids and Search use a Google TV–style shell (top nav, hero, shelves). The Live TV tab uses
a "Live deck": live preview window plus a numbered channel list, for fast zapping. The focused channel's panel
shows country, language, quality and now/next (from direction B). Chosen by the owner from three mockups.

## ADR-002 · Data pipeline: catalogue builder on GitHub Actions, served by GitHub Pages (accepted)
The TV does not ingest raw playlists. A Node builder fetches configured sources, normalises, de-duplicates,
probes a bounded sample of streams with ffprobe, and publishes compact JSON to GitHub Pages (CORS `*`). The TV
downloads only changed shards and caches them; a bundled snapshot covers first run/offline. Requires a public
repository (free Pages); no secrets live in the repo. Reason: `file://` CORS (FND-002), TV memory/CPU, keeping API
keys off the TV.

## ADR-003 · Football data: football-data.org free tier first (accepted)
12 competitions, delayed scores, 10 calls/min, own API key stored as an Actions secret. Paid tiers and other
providers plug into the same `FootballProvider` adapter. Broadcast mapping is a curated file; default "Broadcast
not verified". Never infer a channel carries a match.

## ADR-004 · Movies & Series from legal live channels; VOD adapters for authorised accounts (accepted)
No legal on-demand catalogue exists in the nine repositories. Movies/Series show iptv-org's 24/7 movie and series
channels, labelled as live and grouped by published categories. The full VOD model (movie, series, season,
episode, resume) and adapters (Xtream, M3U VOD, Jellyfin) are built for sources the owner is entitled to.
awesome-zhuiju-free and pay-TV relays are excluded.

## ADR-005 · Stack: TypeScript + Preact 10 + signals, Vite IIFE, ES2015 (accepted)
Small runtime, components, shared TypeScript between the TV app and the builder. Preact 10 (not 11, released
three weeks earlier) — the same line iptvnator's webOS app was tested with. Output is one classic script
(module scripts are blocked under `file://`), CSS limited to Chromium 53 features (FND-001).

## ADR-006 · Own spatial-navigation engine (accepted)
A small engine with nearest-row geometry, container-first search, focus memory, entry rules, traps and
boundaries, instead of LG Enact/Spotlight. Fully unit-tested; focus is marked with a `data-focused` attribute
so re-renders never clear it (BUG-001).

## ADR-007 · Player: engine cascade (accepted, to be validated on the TV in v0.2.0)
Native `<video>` HLS first (hardware pipeline, no CORS needed), then hls.js (only when the stream server sends
CORS headers), then mpegts.js for raw MPEG-TS. The engine that worked is remembered per stream. Streams needing
custom headers, DRM or logins are excluded and labelled (FND-007).

## ADR-008 · App identity (accepted)
Title "FBTV", repository `FBTV`, app id `io.github.<github-user>.fbtv` (lowercase, permanent once installed).
The GitHub user is filled in before the first TV install.

## ADR-009 · Licence: MIT (default, owner may change)
MIT for FBTV's own code; third-party notices in `THIRD_PARTY.md`.
