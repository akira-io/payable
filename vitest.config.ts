import { createRequire } from 'node:module';
import { configDefaults, defineConfig } from 'vitest/config';
import { optionalSuiteExcludes } from './vitest.suites';

const require = createRequire(import.meta.url);

function isInstalled(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

const exclude = [...configDefaults.exclude, ...optionalSuiteExcludes(isInstalled)];

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude,
    passWithNoTests: false,
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        statements: 78,
        branches: 78,
        functions: 78,
        lines: 78,
      },
    },
  },
});
