import { describe, expect, it } from 'vitest';
import { MCP_SUITES, NEST_SUITES, optionalSuiteExcludes } from '../vitest.suites';

describe('optionalSuiteExcludes', () => {
  it('keeps every suite when all optional peers resolve', () => {
    expect(optionalSuiteExcludes(() => true)).toEqual([]);
  });

  it('excludes the MCP suites when the SDK client is absent', () => {
    const excluded = optionalSuiteExcludes(
      (name) => name !== '@modelcontextprotocol/sdk/client/index.js',
    );
    expect(excluded).toEqual(MCP_SUITES);
  });

  it('excludes the nest suite when any of its peers is absent', () => {
    for (const missing of ['@nestjs/common', '@nestjs/core', 'reflect-metadata']) {
      expect(optionalSuiteExcludes((name) => name !== missing)).toEqual(NEST_SUITES);
    }
  });

  it('excludes everything when no optional peer resolves', () => {
    expect(optionalSuiteExcludes(() => false)).toEqual([...MCP_SUITES, ...NEST_SUITES]);
  });
});
