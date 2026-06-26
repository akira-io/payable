const MCP_SDK_PACKAGE = '@modelcontextprotocol/sdk';

export const MCP_DEPENDENCY_HINT = `the MCP transport requires the optional ${MCP_SDK_PACKAGE} peer dependency; install it with: npm install ${MCP_SDK_PACKAGE}`;

export function isMissingMcpDependency(error: unknown): boolean {
  const candidate = error as { code?: string; message?: string };
  if (candidate.code === 'ERR_MODULE_NOT_FOUND' || candidate.code === 'MODULE_NOT_FOUND') {
    return true;
  }
  return typeof candidate.message === 'string' && candidate.message.includes(MCP_SDK_PACKAGE);
}
