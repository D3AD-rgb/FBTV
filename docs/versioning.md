# Versioning, tags and the changelog

Every build that reaches the TV can be traced back to code:

```
IPK filename / About screen version  →  git tag vX.Y.Z  →  CHANGELOG section  →  commits  →  BUG/FND ids
```

## Rules

1. **Commits** use [Conventional Commits](https://www.conventionalcommits.org/): `feat(player): …`,
   `fix(nav): …`, `docs: …`, `test: …`, `chore: …`. A commit that addresses a logged problem names its id:
   `fix(player): fall back when AC-3 fails under hls.js (BUG-007)`.
2. **Each change updates `CHANGELOG.md`** under `## [Unreleased]` in the same commit (Added / Changed /
   Fixed / Removed / Security / Findings).
3. **Problems and discoveries go in [`docs/FINDINGS.md`](FINDINGS.md)** with the next free id. Use
   `Unreleased` in the *Found in* / *Fixed in* columns; the release script stamps the real tag.
4. **Versions** are SemVer `MAJOR.MINOR.PATCH` with no pre-release suffix (webOS requires three integers).
   `package.json` is the single source: the build writes it into `appinfo.json`, the About screen and the IPK
   filename.
5. **Milestones** from the build plan are minor releases (`v0.1.0` … `v0.9.0`, then `v1.0.0`); fixes between them
   are patch releases.

## Cutting a release

```bash
npm run release -- minor          # or patch / major / 0.4.0
npm run release -- minor --dry-run   # preview the section without changing anything
```

The script refuses to run with uncommitted changes or an empty Unreleased section. It then:

1. runs the typecheck and tests,
2. bumps the version in `package.json` / `package-lock.json`,
3. moves Unreleased into `## [X.Y.Z] - date`, appends the commit list (`subject (hash)`) and updates the compare
   links,
4. stamps `Unreleased` cells in `docs/FINDINGS.md` with the tag,
5. commits `chore(release): vX.Y.Z` and creates an **annotated tag whose message is that changelog section**,
6. builds `releases/<app-id>_X.Y.Z_all.ipk` and its `.sha256`.

Then publish:

```bash
git push --follow-tags
gh release create vX.Y.Z releases/*_X.Y.Z_all.ipk* --notes-from-tag --verify-tag
```

## Finding the change behind a problem

- On the TV: **Settings › About** shows the version and commit.
- `git show vX.Y.Z` prints that release's changelog section and commits.
- `git log vX.Y.Z..vX.Y.W --oneline` lists what changed between two installed builds.
- `git log --grep BUG-007` finds every commit that touched a logged problem.
