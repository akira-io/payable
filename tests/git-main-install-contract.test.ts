import { expect, it } from 'vitest';
import packageJson from '../package.json';

it('builds distribution files when installed from Git', () => {
  expect(packageJson.scripts.prepare).toBe('bun run build');
  expect(packageJson.scripts['verify:git-consumer']).toBe('node scripts/verify-git-consumer.mjs');
});
