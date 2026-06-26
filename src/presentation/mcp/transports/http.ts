import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

const DEFAULT_MAX_BODY_BYTES = 1_048_576;

export interface McpHttpServeOptions {
  host?: string;
  port?: number;
  path?: string;
  maxBodyBytes?: number;
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>;
}

export async function serveHttp(
  createMcpServer: () => McpServer,
  options: McpHttpServeOptions = {},
): Promise<Server> {
  const path = options.path ?? '/mcp';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const http = createServer((req, res) => {
    void handle(req, res, createMcpServer, path, maxBodyBytes, options.authenticate);
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
  maxBodyBytes: number,
  authenticate?: (request: IncomingMessage) => boolean | Promise<boolean>,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== path) {
    res.writeHead(404).end();
    return;
  }
  const declaredLength = Number(req.headers['content-length'] ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    res.writeHead(413).end();
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

  let received = 0;
  req.on('data', (chunk: Buffer) => {
    received += chunk.length;
    if (received > maxBodyBytes && !res.headersSent) {
      res.writeHead(413).end();
      req.destroy();
    }
  });

  try {
    await transport.handleRequest(req, res);
  } catch (error) {
    if (!req.destroyed) {
      throw error;
    }
  }
}
