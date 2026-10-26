# Source repository assessment

Researched 25 October 2026. Each repository was shallow-cloned and read; **no code from them was executed**.
Endpoints were checked with live HTTP requests on that date. Numbers will drift; re-check before relying on them.

## Summary

| Repository | What it is | Licence · activity | Verdict |
|---|---|---|---|
| [iptv-org/iptv](https://github.com/iptv-org/iptv) | Community list of free-to-air live channel links (M3U). No VOD, no EPG. | Unlicense/CC0 · daily | **Integrate** |
| ↳ [iptv-org/api](https://github.com/iptv-org/api) | Structured JSON: channels, feeds, streams, logos, guides, blocklist | Unlicense · daily | **Integrate via builder** |
| ↳ [iptv-org/epg](https://github.com/iptv-org/epg) | EPG grabbers you run yourself; nothing hosted | Unlicense · active | **Adapt (run in CI)** |
| [4gray/iptvnator](https://github.com/4gray/iptvnator) | Electron/Angular IPTV player; new experimental webOS TV app (Preact) | MIT (name trademarked) · daily | **Adapt patterns, with credit** |
| [fanmingming/live](https://github.com/fanmingming/live) | TV logo set + China-only EPG; ISP-locked/IPv6 playlists | GPL-3.0 · bot-active | Optional logo fallback |
| [Guovin/iptv-api](https://github.com/Guovin/iptv-api) | Python stream collector/speed tester; output is China-only incl. pay relays | **AGPL-3.0** · active | Idea reference only |
| [HerbertHe/iptv-sources](https://github.com/HerbertHe/iptv-sources) | Aggregator re-publishing other lists (incl. hotel-IPTV leaks) | GPL-3.0 · code idle since Feb 2025 | Reference only |
| [imDazui/Tvlist-awesome-m3u-m3u8](https://github.com/imDazui/Tvlist-awesome-m3u-m3u8) | Hand-collected M3U: China ISP multicast, stale iptv-org copy, pay relays | **No licence** · Nov 2025 | Reference only |
| [iptv-org/awesome-iptv](https://github.com/iptv-org/awesome-iptv) | Link index (moved to GitHub Discussions) | CC0 · active | Reference only |
| [lizongying/my-tv](https://github.com/lizongying/my-tv) | Android TV CCTV app; spoofs a broadcaster's signed API via a closed native library | **No licence**, "study only" · May 2024 | Remote-UX ideas only |
| [laoma528/awesome-zhuiju-free](https://github.com/laoma528/awesome-zhuiju-free) | Drama/VOD sites, TVBox configs, magnet search — 96/126 self-rated high copyright risk | CC BY 4.0 · daily bot | **Do not use** |

## iptv-org/iptv

- **Provides:** M3U playlists of live channels only (FAQ: VOD "No."). Links are user-submitted; DMCA removals go to
  `blocklist.json` (467 dmca + 368 nsfw at the time of research).
- **Format:** source files use `tvg-id="<Channel>@<Feed>"` and titles like `Name (1080p) [Geo-blocked]`; header
  requirements as `#EXTVLCOPT:http-user-agent` / `http-referrer`. Published files add `tvg-logo`, `group-title`
  and inline `http-user-agent=` / `http-referrer=`.
- **Endpoints (verified 200, `Access-Control-Allow-Origin: *`):** `https://iptv-org.github.io/iptv/index.m3u`
  (2.57 MB, 11,333 entries), `index.country.m3u`, `index.category.m3u`, `index.language.m3u`,
  `countries/uk.m3u` (294), `countries/bd.m3u` (43), `categories/news.m3u` (1,029), `categories/sports.m3u`
  (466), `categories/kids.m3u` (430), `categories/animation.m3u` (175), `categories/movies.m3u` (775),
  `categories/series.m3u` (517), `languages/eng.m3u` (3,004), `languages/ara.m3u` (357), `languages/ben.m3u` (106).
  `countries/gb.m3u` is **404** — iptv-org uses `UK` (FND-005).
- **Quality:** `(1080p)` etc. is the submitter's claim; not verified by CI (FND-006).
- **Won't play in webOS `<video>`:** 726 need custom headers (FND-007), 132 DASH, 6 RTMP, 2 UDP; also 517
  geo-blocked, 1,307 "Not 24/7".
- **"Movies"/"Series" categories are 24/7 linear channels**, not on-demand titles.
- **Updates:** `update.yml` daily at 00:00 UTC; validates format/duplicates/blocklist, not liveness.

## iptv-org/api

JSON at `https://iptv-org.github.io/api/` (verified 200, CORS `*`, `max-age=600`):
`channels.json` 7.96 MB (31,674), `streams.json` 3.75 MB (18,056), `feeds.json` 8.10 MB (45,295), `logos.json`
5.76 MB, `guides.json` 25.6 MB (180,678), `countries.json`, `languages.json`, `categories.json` (30),
`regions.json`, `subdivisions.json`, `blocklist.json`, `timezones.json`.

- `channels`: `id, name, alt_names, network, owners, country, categories, is_nsfw, launched, closed, replaced_by, website`
- `streams`: `channel, feed, title, url, quality, labels[], user_agent, referrer`
- `feeds`: `channel, id, name, alt_names, is_main, broadcast_area[], timezones[], languages[], format`
- `logos`: `channel, feed, in_use, tags, width, height, format, url`
- `guides`: `channel, feed, site, site_id, site_name, lang, sources[]` — `sources` empty everywhere (no hosted XMLTV)

Coverage relevant here: 198 UK channels with streams (113 with a guide-site mapping: freeview.co.uk, sky.com,
mytelly.co.uk, i.mjh.nz); 213 English news; 164 English sports; 19 Arabic sports (incl. beIN MENA — paid, not
featured); Bangladesh 43 entries / Bengali 106. Far too large for the TV to fetch on every start → the catalogue
builder slims it.

## iptv-org/epg

Grabbers only (`npm run grab --- --sites=…`), 254 sites incl. sky.com, freeview.co.uk, virgintvgo, bein.com.
`iptv-org.github.io/epg/` is 404; no hosted guides. Plan: run the grabber, pinned to a reviewed commit, in CI for
catalogue channels only. Grabbers scrape listings sites: personal use, check each site's terms.

## 4gray/iptvnator

Nx monorepo, Angular 22, Electron 43, PWA, Node web backend. As of 25 Oct 2026 it merged an experimental webOS TV
app (`apps/tv`, Preact 10, Vite single IIFE for `file://`, `disableBackHistoryAPI: true`, tested on webOS 5).
Useful, MIT-licensed references: geometric focus engine (`libs/tv/ui/src/focus.ts`), native player
(`libs/tv/data-access/src/player.ts`), framework-free Xtream/Stalker clients for the user's own accounts,
`parseXmltvDate`. Its TV app depends on its backend for CORS; FBTV uses the catalogue builder instead. Missing
there: CH+/−, number entry, XMLTV for M3U sources.

## fanmingming/live

~930 logos (~437 Latin-named) under `/tv/{name}.png`; `e.xml` China-only EPG (132 channels, refreshed every 2 h
from another project). Playlists are IPv6-only (China Mobile) or ISP-internal; `itv.m3u` includes paid ISP
packages. GPL-3.0; logos are broadcaster trademarks. Optional logo fallback only.

## Guovin/iptv-api

AGPL-3.0 — no code reuse. Its validation algorithm is a good design reference (HEAD + manual redirects, master
playlist variant selection, segment speed sampling with early stop, ffprobe fallback, per-resolution speed
thresholds, exponential freeze/backoff). Published output: 839 entries, 100% China/HK/TW, including pay channels
re-streamed via relays and home NAS addresses — not consumed. Older versions harvested exposed hotel IPTV via FOFA;
removed in v2.0.0 and must not be replicated.

## HerbertHe/iptv-sources

Aggregator publishing to `m3u.ibert.me` every 2 h (outputs live but partly stale/broken, e.g. an EPG file that is
an HTML proxy page). Inputs include hotel-IPTV leak lists. GPL-3.0; code idle since Feb 2025. Reference only —
fetch upstream sources directly.

## imDazui/Tvlist-awesome-m3u-m3u8

224 files (~57,600 EXTINF lines, heavily duplicated), mostly China ISP multicast/RTSP/udpxy; a 2022 iptv-org copy;
pay-TV relays; several README links 404. No licence. Reference only.

## iptv-org/awesome-iptv

Index moved to GitHub Discussions. Useful pointers: webOS players (competitor references), EPG providers, stream
checkers. Lists paid "IPTV + VOD" resellers that are almost certainly unlicensed — not linked or used.

## lizongying/my-tv

Kotlin Android TV app; channel list hard-coded; obtains streams by spoofing the yangshipin web player and computing
signatures via a closed `libnative.so` — access-control circumvention. No licence file; "study only". Only its
remote UX (CH/arrows switch channel, OK opens list, two-digit entry, double-Back to exit) is borrowed as ideas.

## laoma528/awesome-zhuiju-free

126 entries (54 VOD sites, 17 TVBox configs, 16 magnet sites…) with its own risk scores marking 96 as high
copyright risk; no official free services. Not used for Movies/Series — doing so would facilitate infringement.

## Legal on-demand options (none come from the nine repositories)

- The user's own **Jellyfin / Plex / Emby** server.
- An **Xtream Codes** account the user subscribes to (bring-your-own-account; nothing bundled).
- An **authorised VOD M3U**.
- **TMDB** for metadata only (commercial use needs an agreement; attribution notice required).
