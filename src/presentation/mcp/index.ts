import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Payable } from '../../payable';
import type { McpPayableOptions } from './options';
import { registerPrompts } from './prompts/register';
import { registerResources } from './resources/register';
import { registerTools } from './tools/register';

export function createPayableMcpServer(
  payable: Payable,
  options: McpPayableOptions = {},
): McpServer {
  const server = new McpServer({
    name: options.serverInfo?.name ?? 'payable',
    version: options.serverInfo?.version ?? '0.1.0',
  });
  registerTools(server, payable, options);
  registerResources(server, payable);
  registerPrompts(server);
  return server;
}

export type { McpPayableOptions, McpPolicy, McpServerInfo, ToolArgs } from './options';
export { type McpHttpServeOptions, serveHttp } from './transports/http';
export { serveStdio } from './transports/stdio';
