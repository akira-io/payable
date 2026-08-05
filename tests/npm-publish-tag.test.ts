import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('npm publish dist-tag selection', () => {
  it.each([
    ['1.0.0-beta5', 'beta'],
    ['1.0.0-rc.1', 'beta'],
    ['1.0.0', 'latest'],
  ])('maps version %s to the %s release channel', (version, expectedTag) => {
    const result = spawnSync(process.execPath, ['scripts/select-npm-publish-tag.mjs', version], {
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(expectedTag);
  });
});
