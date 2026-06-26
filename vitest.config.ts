import { createRequire } from 'node:module';
import { configDefaults, defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

function isInstalled(name: string): boolean {
  try {
    require.resolve(name);
    return true;
  } catch {
    return false;
  }
}

const exclude = [...configDefaults.exclude];
if (!isInstalled('@modelcontextprotocol/sdk/client/index.js')) {
  exclude.push('tests/mcp-tools.test.ts', 'tests/mcp-http.test.ts', 'tests/mcp-policy.test.ts');
}
if (!isInstalled('@nestjs/common')) {
  exclude.push('tests/nest.test.ts');
}

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
