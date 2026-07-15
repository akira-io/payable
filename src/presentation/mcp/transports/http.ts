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
  enableDnsRebindingProtection?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

interface TransportOptions {
  enableDnsRebindingProtection: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

function defaultAllowedHosts(req: IncomingMessage): string[] {
  const port = req.socket.localPort;
  return [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
}

export async function serveHttp(
  createMcpServer: () => McpServer,
  options: McpHttpServeOptions = {},
): Promise<Server> {
  const path = options.path ?? '/mcp';
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const transportOptions: TransportOptions = {
    enableDnsRebindingProtection: options.enableDnsRebindingProtection ?? true,
    allowedHosts: options.allowedHosts,
    allowedOrigins: options.allowedOrigins,
  };
  const http = createServer((req, res) => {
    handle(
      req,
      res,
      createMcpServer,
      path,
      maxBodyBytes,
      transportOptions,
      options.authenticate,
    ).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500).end();
        return;
      }
      res.destroy();
    });
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
  transportOptions: TransportOptions,
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
  let parsedBody: unknown;
  if (req.method === 'POST') {
    const body = await readBodyWithin(req, maxBodyBytes);
    if (!body.ok) {
      res.writeHead(413).end();
      return;
    }
    try {
      parsedBody = JSON.parse(body.text || 'null');
    } catch {
      res.writeHead(400).end();
      return;
    }
  }
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: transportOptions.enableDnsRebindingProtection,
    allowedHosts: transportOptions.allowedHosts ?? defaultAllowedHosts(req),
    allowedOrigins: transportOptions.allowedOrigins,
  });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);

  try {
    await transport.handleRequest(req, res, parsedBody);
  } catch (error) {
    if (!req.destroyed) {
      throw error;
    }
  }
}

type BodyReadResult = { ok: true; text: string } | { ok: false };

function readBodyWithin(req: IncomingMessage, maxBodyBytes: number): Promise<BodyReadResult> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let settled = false;
    const settle = (result: BodyReadResult) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    req.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (received > maxBodyBytes) {
        req.pause();
        settle({ ok: false });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => settle({ ok: true, text: Buffer.concat(chunks).toString('utf8') }));
    req.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}
