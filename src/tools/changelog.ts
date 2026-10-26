/**
 * Pure changelog/version logic used by scripts/release.mjs (Keep a Changelog format).
 * Kept free of I/O so it can be unit tested.
 */
export type Bump = 'patch' | 'minor' | 'major' | string;

export function nextVersion(current: string, kind: Bump): string {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const parts = current.split('.').map(Number);
  const maj = parts[0] || 0;
  const min = parts[1] || 0;
  const pat = parts[2] || 0;
  if (kind === 'major') return `${maj + 1}.0.0`;
  if (kind === 'minor') return `${maj}.${min + 1}.0`;
  if (kind === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump "${kind}" (use patch, minor, major or X.Y.Z)`);
}

export interface SplitChangelog {
  /** Title and intro before "## [Unreleased]". */
  before: string;
  /** Body of the Unreleased section. */
  unreleased: string;
  /** Older release sections (without link references). */
  older: string;
  /** Link reference lines, excluding the old [Unreleased] link. */
  links: string[];
}

const LINK_RE = /^\[[^\]]+\]: /;

export function splitChangelog(text: string): SplitChangelog {
  const start = text.indexOf('## [Unreleased]');
  if (start < 0) throw new Error('CHANGELOG.md has no "## [Unreleased]" heading.');
  const bodyStart = text.indexOf('\n', start) + 1;
  const lines = text.slice(bodyStart).split('\n');
  const unreleased: string[] = [];
  const older: string[] = [];
  const links: string[] = [];
  let inOlder = false;
  for (const line of lines) {
    if (LINK_RE.test(line)) {
      if (!/^\[Unreleased\]:/.test(line)) links.push(line);
      continue;
    }
    if (/^## \[/.test(line)) inOlder = true;
    (inOlder ? older : unreleased).push(line);
  }
  return {
    before: text.slice(0, start),
    unreleased: unreleased.join('\n').trim(),
    older: older.join('\n').trim(),
    links,
  };
}

export function hasEntries(unreleased: string): boolean {
  return /^\s*[-*] /m.test(unreleased);
}

export interface ReleaseInput {
  changelog: string;
  version: string;
  prevTag: string | null;
  date: string;
  commits: string[];
  repoUrl: string;
}

export interface ReleaseOutput {
  changelog: string;
  /** The new section, also used as the annotated tag message. */
  section: string;
}

export function composeRelease(input: ReleaseInput): ReleaseOutput {
  const tag = `v${input.version}`;
  const parts = splitChangelog(input.changelog);
  if (!hasEntries(parts.unreleased)) throw new Error('No entries under "## [Unreleased]".');
  const commits = input.commits.length ? input.commits.join('\n') : '- (no commits)';
  const section = `## [${input.version}] - ${input.date}\n\n${parts.unreleased}\n\n### Commits\n\n${commits}\n`;
  const compare = input.prevTag
    ? `${input.repoUrl}/compare/${input.prevTag}...${tag}`
    : `${input.repoUrl}/releases/tag/${tag}`;
  const links = [`[Unreleased]: ${input.repoUrl}/compare/${tag}...HEAD`, `[${input.version}]: ${compare}`].concat(
    parts.links,
  );
  const changelog =
    `${parts.before}## [Unreleased]\n\n${section}\n` +
    (parts.older ? `${parts.older}\n\n` : '') +
    `${links.join('\n')}\n`;
  return { changelog, section };
}

/** Marks FINDINGS rows recorded against "Unreleased" with the released tag. */
export function stampFindings(text: string, tag: string): string {
  return text.replace(/\|\s*Unreleased\s*\|/g, `| ${tag} |`);
}
