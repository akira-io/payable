import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
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
