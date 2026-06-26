import { describe, expect, it } from 'vitest';
import { isMissingMcpDependency, MCP_DEPENDENCY_HINT } from '../src/presentation/mcp/dependencies';

describe('isMissingMcpDependency', () => {
  it('detects a module-not-found error code', () => {
    expect(isMissingMcpDependency({ code: 'ERR_MODULE_NOT_FOUND' })).toBe(true);
    expect(isMissingMcpDependency({ code: 'MODULE_NOT_FOUND' })).toBe(true);
  });

  it('detects the SDK package name in the message', () => {
    expect(
      isMissingMcpDependency(new Error("Cannot find package '@modelcontextprotocol/sdk'")),
    ).toBe(true);
  });

  it('ignores unrelated errors', () => {
    expect(isMissingMcpDependency(new Error('boom'))).toBe(false);
    expect(isMissingMcpDependency({ code: 'EACCES' })).toBe(false);
  });

  it('names the package in the install hint', () => {
    expect(MCP_DEPENDENCY_HINT).toContain('@modelcontextprotocol/sdk');
  });
});
