import { describe, expect, it } from 'vitest';
import {
  MCP_SUITES,
  NEST_SUITES,
  optionalSuiteExcludes,
  PRISMA_SUITES,
  TMT_INTEGRATION_SUITES,
} from '../vitest.suites';

const TMT_ENV = {
  TMT_PATH: 'test-site',
  TMT_API_TOKEN: 'token',
  TMT_CHANNEL_ID: '2452',
  TMT_CHANNEL_SECRET: 'secret',
};

describe('optionalSuiteExcludes', () => {
  it('classifies provider-neutral Prisma pages as an optional Prisma suite', () => {
    expect(PRISMA_SUITES).toContain('tests/prisma-provider-neutral-pages.test.ts');
  });

  it('keeps every suite when all optional peers resolve', () => {
    expect(optionalSuiteExcludes(() => true, TMT_ENV)).toEqual([]);
  });

  it('excludes the real TMT suite unless every credential variable is present', () => {
    expect(optionalSuiteExcludes(() => true, {})).toEqual(TMT_INTEGRATION_SUITES);
    expect(optionalSuiteExcludes(() => true, { ...TMT_ENV, TMT_CHANNEL_SECRET: '' })).toEqual(
      TMT_INTEGRATION_SUITES,
    );
  });

  it('excludes the MCP suites when the SDK client is absent', () => {
    const excluded = optionalSuiteExcludes(
      (name) => name !== '@modelcontextprotocol/sdk/client/index.js',
      TMT_ENV,
    );
    expect(excluded).toEqual(MCP_SUITES);
  });

  it('excludes the nest suite when any of its peers is absent', () => {
    for (const missing of ['@nestjs/common', '@nestjs/core', 'reflect-metadata']) {
      expect(optionalSuiteExcludes((name) => name !== missing, TMT_ENV)).toEqual(NEST_SUITES);
    }
  });

  it('excludes the prisma suite when @prisma/client is absent', () => {
    expect(optionalSuiteExcludes((name) => name !== '@prisma/client', TMT_ENV)).toEqual(
      PRISMA_SUITES,
    );
  });

  it('excludes everything when no optional peer resolves', () => {
    expect(optionalSuiteExcludes(() => false, {})).toEqual([
      ...MCP_SUITES,
      ...NEST_SUITES,
      ...PRISMA_SUITES,
      ...TMT_INTEGRATION_SUITES,
    ]);
  });
});
