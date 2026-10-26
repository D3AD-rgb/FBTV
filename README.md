# FBTV

A Google TV–inspired IPTV app for LG webOS TVs: live channels, a football hub, news, sports, countries, 4K,
movies, series and kids, built for the remote control.

FBTV plays **publicly available streams only**. It does not bypass DRM, logins, paywalls or geographic
restrictions, and a channel appearing in a list does not mean it is streaming right now.

## Status

| Milestone | Tag | State |
|---|---|---|
| Foundations: shell, design system, focus engine, Back handling, Diagnostics, packaging | v0.1.0 | in progress |
| Playback probe on the TV | v0.2.0 | planned |
| Catalogue builder, Live TV, countries, favourites | v0.3.0 | planned |
| Player | v0.4.0 | planned |
| UK TV, News, Sports, 4K, search | v0.5.0 | planned |
| Football hub | v0.6.0 | planned |
| Programme guide | v0.7.0 | planned |
| Movies & Series | v0.8.0 | planned |
| Kids Mode, settings, performance | v0.9.0 | planned |
| Release | v1.0.0 | planned |

What changed in each version: [CHANGELOG.md](CHANGELOG.md). Known issues and platform findings:
[docs/FINDINGS.md](docs/FINDINGS.md).

## Quick start

Requirements: Node.js 24+, the LG webOS CLI (`npm install -g @webos-tools/cli`), a TV in Developer Mode.

```bash
npm install
```

```bash
npm run dev
```

`npm run dev` serves the app at http://localhost:5173 (arrow keys = remote, Enter = OK, Esc = Back, F1–F4 = colour
keys).

```bash
npm run check
```

```bash
npm run package
```

```bash
npm run deploy
```

| Command | What it does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Unit tests (Vitest) |
| `npm run build` | Production build into `dist/app` |
| `npm run check` | Typecheck + tests + build |
| `npm run package` | Build and create `releases/<app-id>_<version>_all.ipk` (+ `.sha256`) with `ares-package` |
| `npm run deploy` | Install the IPK on the TV and launch it (`--device`, `--no-launch`, `--inspect`) |
| `npm run release -- minor` | Version bump, changelog section, annotated tag, IPK ([docs/versioning.md](docs/versioning.md)) |

TV pairing, installation, logs and troubleshooting: [docs/deploy-webos.md](docs/deploy-webos.md).

## Documentation

- [Architecture](docs/architecture.md) — catalogue builder, TV runtime, repository layout
- [Decisions](docs/decisions.md) — why the build is shaped this way
- [Source research](docs/research/sources.md) — the nine repositories assessed, with verdicts
- [Design system](docs/design-system.md) — tokens, components, layout rules
- [Remote control](docs/remote-control.md) — key map
- [Versioning](docs/versioning.md) — commits, changelog, tags, releases
- [Third-party notices](THIRD_PARTY.md)

## Licence

MIT for FBTV's own code ([LICENSE](LICENSE)). Data and libraries keep their own licences ([THIRD_PARTY.md](THIRD_PARTY.md)).
