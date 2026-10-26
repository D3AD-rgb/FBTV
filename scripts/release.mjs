// Cuts a release: version bump → CHANGELOG section → FINDINGS update → commit →
// annotated tag (message = the changelog section) → IPK in releases/.
//
// Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run] [--skip-checks] [--no-package]
//
// Rules (see docs/versioning.md):
//  - Work in progress is written under "## [Unreleased]" in CHANGELOG.md as part of each change.
//  - The release refuses to run with an empty Unreleased section or a dirty working tree.
//  - FINDINGS.md rows whose "Found in" / "Fixed in" is "Unreleased" get the new tag.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { ROOT, run, out, arg, readJSON } from './lib/util.mjs';
import { nextVersion, splitChangelog, hasEntries, composeRelease, stampFindings } from '../src/tools/changelog.ts';

const bump = process.argv[2];
const dryRun = !!arg('dry-run', false);
if (!bump || bump.startsWith('--')) {
  console.error('Usage: npm run release -- <patch|minor|major|X.Y.Z> [--dry-run]');
  process.exit(1);
}
const git = (...args) => out('git', args);

if (!dryRun && git('status', '--porcelain')) {
  console.error('Working tree is not clean. Commit or stash changes first.');
  process.exit(1);
}

const pkg = readJSON('package.json');
const version = nextVersion(pkg.version, bump);
const tag = `v${version}`;
if (git('tag', '--list', tag)) {
  console.error(`Tag ${tag} already exists.`);
  process.exit(1);
}

const changelogPath = resolve(ROOT, 'CHANGELOG.md');
const changelog = readFileSync(changelogPath, 'utf8');
if (!hasEntries(splitChangelog(changelog).unreleased)) {
  console.error('CHANGELOG.md has no entries under "## [Unreleased]". Describe the changes first.');
  process.exit(1);
}

if (!arg('skip-checks', false) && !dryRun) {
  run('npm', ['run', 'typecheck']);
  run('npm', ['test']);
}

const prevTag = latestTag();
const commits = git('log', prevTag ? `${prevTag}..HEAD` : 'HEAD', '--no-merges', '--format=- %s (%h)')
  .split('\n')
  .filter((l) => l && !/chore\(release\)/.test(l));
const result = composeRelease({
  changelog,
  version,
  prevTag: prevTag || null,
  date: new Date().toISOString().slice(0, 10),
  commits,
  repoUrl: repositoryUrl(),
});

if (dryRun) {
  console.log(`Would release ${tag} (previous: ${prevTag || 'none'})\n\n${result.section}`);
  process.exit(0);
}

pkg.version = version;
writeFileSync(resolve(ROOT, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const lockPath = resolve(ROOT, 'package-lock.json');
try {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  lock.version = version;
  if (lock.packages && lock.packages['']) lock.packages[''].version = version;
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
} catch {
  /* no lockfile */
}
writeFileSync(changelogPath, result.changelog);
const findingsPath = resolve(ROOT, 'docs', 'FINDINGS.md');
writeFileSync(findingsPath, stampFindings(readFileSync(findingsPath, 'utf8'), tag));

run('git', ['add', 'package.json', 'package-lock.json', 'CHANGELOG.md', 'docs/FINDINGS.md']);
run('git', ['commit', '-m', `chore(release): ${tag}`]);
const msgFile = join(mkdtempSync(join(tmpdir(), 'fbtv-release-')), 'TAG_MSG');
writeFileSync(msgFile, `FBTV ${tag}\n\n${result.section}`);
// verbatim: the default cleanup strips lines starting with '#', i.e. the markdown headings (BUG-004).
run('git', ['tag', '-a', tag, '--cleanup=verbatim', '-F', msgFile]);

if (!arg('no-package', false)) run(process.execPath, [resolve(ROOT, 'scripts', 'package.mjs')]);

console.log(`\nReleased ${tag}.`);
console.log(`  Inspect:  git show ${tag}`);
console.log('  Publish:  git push --follow-tags');
console.log(`  GitHub:   gh release create ${tag} releases/*_${version}_all.ipk* --notes-from-tag`);

function latestTag() {
  try {
    return git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*');
  } catch {
    return '';
  }
}

function repositoryUrl() {
  try {
    const url = git('remote', 'get-url', 'origin');
    return url.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
  } catch {
    return readJSON('fbtv.config.json').repositoryUrl || 'https://github.com/OWNER/FBTV';
  }
}
