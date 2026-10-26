import { describe, expect, it } from 'vitest';
import { composeRelease, nextVersion, splitChangelog, stampFindings } from '../src/tools/changelog.ts';

const FIRST = `# Changelog

Intro text.

## [Unreleased]

### Added
- Focus engine (FND-001)
`;

describe('nextVersion', () => {
  it('bumps semver parts and accepts explicit versions', () => {
    expect(nextVersion('0.1.3', 'patch')).toBe('0.1.4');
    expect(nextVersion('0.1.3', 'minor')).toBe('0.2.0');
    expect(nextVersion('0.9.9', 'major')).toBe('1.0.0');
    expect(nextVersion('0.0.0', '0.1.0')).toBe('0.1.0');
    expect(() => nextVersion('0.1.0', 'huge')).toThrow();
  });
});

describe('composeRelease', () => {
  it('turns Unreleased into a dated, tagged section with commits and links', () => {
    const r = composeRelease({
      changelog: FIRST,
      version: '0.1.0',
      prevTag: null,
      date: '2026-10-26',
      commits: ['- feat(nav): focus engine (abc1234)'],
      repoUrl: 'https://github.com/me/FBTV',
    });
    expect(r.changelog).toContain('## [Unreleased]\n\n## [0.1.0] - 2026-10-26');
    expect(r.changelog).toContain('- Focus engine (FND-001)');
    expect(r.changelog).toContain('### Commits\n\n- feat(nav): focus engine (abc1234)');
    expect(r.changelog).toContain('[Unreleased]: https://github.com/me/FBTV/compare/v0.1.0...HEAD');
    expect(r.changelog).toContain('[0.1.0]: https://github.com/me/FBTV/releases/tag/v0.1.0');
    expect(r.section.startsWith('## [0.1.0] - 2026-10-26')).toBe(true);
  });

  it('keeps older sections and links on the next release', () => {
    const first = composeRelease({
      changelog: FIRST,
      version: '0.1.0',
      prevTag: null,
      date: '2026-10-26',
      commits: [],
      repoUrl: 'https://github.com/me/FBTV',
    }).changelog;
    const withNew = first.replace('## [Unreleased]\n', '## [Unreleased]\n\n### Fixed\n- Back key on Home (BUG-002)\n');
    const second = composeRelease({
      changelog: withNew,
      version: '0.2.0',
      prevTag: 'v0.1.0',
      date: '2026-11-02',
      commits: ['- fix(nav): back key (def5678)'],
      repoUrl: 'https://github.com/me/FBTV',
    }).changelog;
    const parts = splitChangelog(second);
    expect(parts.unreleased).toBe('');
    expect(second.indexOf('## [0.2.0]')).toBeLessThan(second.indexOf('## [0.1.0]'));
    expect(second).toContain('[0.2.0]: https://github.com/me/FBTV/compare/v0.1.0...v0.2.0');
    expect(second).toContain('[0.1.0]: https://github.com/me/FBTV/releases/tag/v0.1.0');
    expect(second.match(/^\[Unreleased\]:/gm)).toHaveLength(1);
  });

  it('refuses an empty Unreleased section', () => {
    expect(() =>
      composeRelease({
        changelog: '# Changelog\n\n## [Unreleased]\n\n',
        version: '0.1.0',
        prevTag: null,
        date: '2026-10-26',
        commits: [],
        repoUrl: 'x',
      }),
    ).toThrow();
  });
});

describe('stampFindings', () => {
  it('replaces Unreleased cells with the tag', () => {
    const row = '| BUG-001 | Bug | v0.1.0 | Fixed | Unreleased | Focus lost |';
    expect(stampFindings(row, 'v0.1.1')).toBe('| BUG-001 | Bug | v0.1.0 | Fixed | v0.1.1 | Focus lost |');
  });
});
