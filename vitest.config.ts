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
        'src/domain/value-objects/money.ts': {
          statements: 90,
          branches: 80,
          functions: 100,
          lines: 90,
        },
        'src/infrastructure/audit/audit-chain.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
        'src/support/hash/request-hash.ts': {
          statements: 100,
          branches: 95,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
