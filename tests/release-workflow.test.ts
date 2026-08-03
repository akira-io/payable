import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

describe('release workflow', () => {
  it('commits release metadata directly to the default branch', () => {
    expect(releaseWorkflow).toContain('pull-requests: read');
    expect(releaseWorkflow).toContain(
      `DEFAULT_BRANCH="$(git remote show origin | sed -n 's/.*HEAD branch: //p')"`,
    );
    expect(releaseWorkflow).toContain('git add CHANGELOG.md package.json');
    expect(releaseWorkflow).toContain(`git commit -m "chore(changelog): \${{ github.ref_name }}"`);
    expect(releaseWorkflow).toContain(`git push origin "HEAD:\${DEFAULT_BRANCH}"`);
    expect(releaseWorkflow).not.toContain(`git push origin "HEAD:\${DEFAULT_BRANCH}" || true`);
    expect(releaseWorkflow).not.toContain('Open release pull request');
    expect(releaseWorkflow).not.toContain(`BRANCH="release/\${{ github.ref_name }}"`);
    expect(releaseWorkflow).not.toContain('gh pr create');
  });
});
