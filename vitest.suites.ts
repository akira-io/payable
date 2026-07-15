export const MCP_SUITES = [
  'tests/mcp-tools.test.ts',
  'tests/mcp-http.test.ts',
  'tests/mcp-policy.test.ts',
];

export const NEST_SUITES = ['tests/nest.test.ts'];

export const PRISMA_SUITES = ['tests/prisma-contract.test.ts', 'tests/prisma-encryption.test.ts'];

const MCP_PROBE = '@modelcontextprotocol/sdk/client/index.js';
const NEST_PROBES = ['@nestjs/common', '@nestjs/core', 'reflect-metadata'];
const PRISMA_PROBE = '@prisma/client';

export function optionalSuiteExcludes(isInstalled: (name: string) => boolean): string[] {
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
  return exclude;
}
