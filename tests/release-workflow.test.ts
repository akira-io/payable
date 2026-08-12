import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');
const publishWorkflow = readFileSync('.github/workflows/publish.yml', 'utf8');

function verify(tag: string, version: string, changelog: string) {
  const root = mkdtempSync(join(tmpdir(), 'payable-release-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(root, 'CHANGELOG.md'), changelog);
  return spawnSync(process.execPath, ['scripts/verify-release-metadata.mjs', tag, root], {
    encoding: 'utf8',
  });
}

describe('release metadata integrity', () => {
  it('accepts a tag whose package and changelog already match', () => {
    const result = verify(
      'v1.0.0-beta8',
      '1.0.0-beta8',
      '## [1.0.0-beta8](https://github.com/akira-io/payable/compare/v1.0.0-beta7...v1.0.0-beta8)',
    );
    expect(result.status).toBe(0);
  });

  it.each([
    ['v1.0.0-beta8', '1.0.0-beta7', '## [1.0.0-beta8]'],
    ['v1.0.0-beta8', '1.0.0-beta8', '## [1.0.0-beta7]'],
    ['v1.0.0-beta8', '1.0.0-beta8', '## [1.0.0-beta8]'],
    ['v1.0.0-beta8; echo compromised', '1.0.0-beta8', '## [1.0.0-beta8]'],
  ])('rejects inconsistent or unsafe metadata', (tag, version, changelog) => {
    expect(verify(tag, version, changelog).status).not.toBe(0);
  });
});

describe('release workflows', () => {
  it('validates immutable metadata instead of rewriting the tagged tree', () => {
    for (const workflow of [releaseWorkflow, publishWorkflow]) {
      expect(workflow).toContain('node scripts/verify-release-metadata.mjs "$GITHUB_REF_NAME"');
      expect(workflow).not.toContain('npm version');
      expect(workflow).not.toContain('git commit');
      expect(workflow).not.toContain('git push origin');
    }
    expect(releaseWorkflow).not.toContain('git-cliff --config cliff.toml --tag');
  });

  it('retains npm provenance and computed prerelease dist-tags', () => {
    expect(publishWorkflow).toContain('npm@11 publish --access public --provenance --tag "$TAG"');
    expect(publishWorkflow).toContain('scripts/select-npm-publish-tag.mjs "$VER"');
  });
});
