import { defineConfig } from 'vitest/config';

// biome-ignore lint/style/noDefaultExport: Vitest discovers configuration through a default export.
export default defineConfig({
  test: {
    include: ['tests/trust-my-travel.integration.test.ts'],
    maxWorkers: 1,
    passWithNoTests: false,
  },
});
