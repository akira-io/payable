import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export interface McpHttpServeOptions {
  host?: string;
  port?: number;
  path?: string;
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>;
}

export async function serveHttp(
  createMcpServer: () => McpServer,
  options: McpHttpServeOptions = {},
): Promise<Server> {
  const path = options.path ?? '/mcp';
  const http = createServer((req, res) => {
    void handle(req, res, createMcpServer, path, options.authenticate);
  });
  await new Promise<void>((resolve) => {
    http.listen(options.port ?? 3333, options.host ?? '127.0.0.1', resolve);
  });
  return http;
}

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  createMcpServer: () => McpServer,
  path: string,
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== path) {
    res.writeHead(404).end();
    return;
  }
  if (authenticate && !(await authenticate(req))) {
    res.writeHead(401).end();
    return;
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}
