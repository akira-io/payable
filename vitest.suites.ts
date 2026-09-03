export const MCP_SUITES = [
  'tests/mcp-tools.test.ts',
  'tests/mcp-http.test.ts',
  'tests/mcp-policy.test.ts',
];

export const NEST_SUITES = ['tests/nest.test.ts'];

export const PRISMA_SUITES = [
  'tests/prisma-contract.test.ts',
  'tests/prisma-provider-neutral-pages.test.ts',
  'tests/prisma-canonical-reset.test.ts',
];

export const TMT_INTEGRATION_SUITES = ['tests/trust-my-travel.integration.test.ts'];

const MCP_PROBE = '@modelcontextprotocol/sdk/client/index.js';
const NEST_PROBES = ['@nestjs/common', '@nestjs/core', 'reflect-metadata'];
const PRISMA_PROBE = '@prisma/client';
const TMT_INTEGRATION_VARIABLES = [
  'TMT_PATH',
  'TMT_API_TOKEN',
  'TMT_CHANNEL_ID',
  'TMT_CHANNEL_SECRET',
] as const;

export function optionalSuiteExcludes(
  isInstalled: (name: string) => boolean,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const exclude: string[] = [];
  if (!isInstalled(MCP_PROBE)) {
    exclude.push(...MCP_SUITES);
  }
  if (!NEST_PROBES.every(isInstalled)) {
    exclude.push(...NEST_SUITES);
  }
  if (!isInstalled(PRISMA_PROBE)) {
    exclude.push(...PRISMA_SUITES);
  }
  if (!TMT_INTEGRATION_VARIABLES.every((name) => Boolean(environment[name]?.trim()))) {
    exclude.push(...TMT_INTEGRATION_SUITES);
  }
  return exclude;
}
