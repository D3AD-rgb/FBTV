# Third-party software, data and credits

## Runtime libraries (bundled)

| Component | Licence | Use |
|---|---|---|
| [Preact](https://github.com/preactjs/preact) 10 | MIT | UI rendering |
| [@preact/signals](https://github.com/preactjs/signals) | MIT | State |
| [hls.js](https://github.com/video-dev/hls.js) | Apache-2.0 | HLS playback over MSE (fallback engine, loaded on demand) |
| [mpegts.js](https://github.com/xqq/mpegts.js) | Apache-2.0 | MPEG-TS playback over MSE (fallback engine, loaded on demand) |
| [Manrope](https://github.com/sharanda/manrope) via @fontsource | SIL Open Font License 1.1 | Interface font |

## Code patterns adapted

- **iptvnator** — <https://github.com/4gray/iptvnator>, MIT, © 2019-2026 4gray. The spatial-navigation and
  native-player approach of its experimental webOS TV app (`libs/tv/ui/src/focus.ts`,
  `libs/tv/data-access/src/player.ts`) informed FBTV's focus engine and player. No IPTVnator branding is used
  (see its TRADEMARK.md).

## Data sources

- **iptv-org** (iptv, api, database, epg) — <https://github.com/iptv-org>, released into the public domain
  (Unlicense / CC0). Channel metadata, stream links (user-submitted links to publicly available streams),
  logos references and guide-site mappings. FBTV honours the iptv-org blocklist.
- **football-data.org** — fixtures and scores when configured with your own free API key; subject to its terms.
- **openfootball** — public-domain fixture data (optional fallback).

Repositories that were assessed but are not used are listed with reasons in
[docs/research/sources.md](docs/research/sources.md).

Channel names and logos are trademarks of their owners and are shown only to identify channels.

## Clearstream

Lists of restream hosts, official free-channel platforms and pay-TV sports brands, and extra sport tags for
national channels (`src/library/policy.ts`), adapted from Clearstream by killerwaz
(https://github.com/killerwaz/clearstream), MIT License.

