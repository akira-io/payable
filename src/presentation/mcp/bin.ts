#!/usr/bin/env node
import { timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PayableError } from '../../domain/errors/payable-error';
import type { Payable } from '../../payable';
import { isMissingMcpDependency, MCP_DEPENDENCY_HINT } from './dependencies';
import type { McpPayableOptions } from './options';

async function loadTransport(): Promise<{
  createPayableMcpServer: typeof import('./index').createPayableMcpServer;
  serveHttp: typeof import('./transports/http').serveHttp;
  serveStdio: typeof import('./transports/stdio').serveStdio;
}> {
  const [{ createPayableMcpServer }, { serveHttp }, { serveStdio }] = await Promise.all([
    import('./index'),
    import('./transports/http'),
    import('./transports/stdio'),
  ]);
  return { createPayableMcpServer, serveHttp, serveStdio };
}

interface PayableMcpConfig {
  payable: Payable;
  mcp?: McpPayableOptions;
}

function readFlag(name: string): string | boolean | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) {
    return undefined;
  }
  const value = process.argv[index + 1];
  if (value && !value.startsWith('--')) {
    return value;
  }
  return true;
}

function notify(message: string): void {
  process.stderr.write(`payable-mcp: ${message}\n`);
}

function bearerMatches(header: string | undefined, token: string): boolean {
  const expected = `Bearer ${token}`;
  if (typeof header !== 'string' || header.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}

async function loadConfig(path: string): Promise<PayableMcpConfig> {
  const module = await import(pathToFileURL(resolve(path)).href);
  const exported = module.default ?? module;
  if (exported && typeof exported === 'object' && 'payable' in exported) {
    return exported as PayableMcpConfig;
  }
  return { payable: exported as Payable };
}

function parsePort(port: string | undefined): number | undefined {
  if (!port) {
    return undefined;
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new PayableError(`Invalid --http port: ${port}`, { code: 'MCP_INVALID_PORT' });
  }
  return parsed;
}

function parseHost(value: string | boolean | undefined): { host?: string; port?: number } {
  if (typeof value !== 'string') {
    return {};
  }
  const [host, port] = value.split(':');
  return { host: host || undefined, port: parsePort(port) };
}

function isLoopbackHost(host: string | undefined): boolean {
  return host === undefined || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

async function main(): Promise<void> {
  const configPath = readFlag('--config');
  if (typeof configPath !== 'string') {
    notify('missing required --config <path>');
    process.exitCode = 1;
    return;
  }
  const { payable, mcp } = await loadConfig(configPath);
  const moneyOn = mcp?.policy?.allowMoneyMovement === true && mcp?.policy?.readOnly !== true;
  notify(`money movement ${moneyOn ? 'ENABLED' : 'disabled'}`);

  const { createPayableMcpServer, serveHttp, serveStdio } = await loadTransport();
  const httpFlag = readFlag('--http');
  if (httpFlag) {
    const { host, port } = parseHost(httpFlag);
    const token = process.env.PAYABLE_MCP_TOKEN;
    if (!token) {
      if (!isLoopbackHost(host)) {
        notify(`refusing to bind ${host} without PAYABLE_MCP_TOKEN; HTTP transport would be open`);
        process.exitCode = 1;
        return;
      }
      notify('WARNING: no PAYABLE_MCP_TOKEN set; HTTP transport is unauthenticated');
    }
    await serveHttp(() => createPayableMcpServer(payable, mcp), {
      host,
      port,
      authenticate: token
        ? (request) => bearerMatches(request.headers.authorization, token)
        : undefined,
    });
    notify(`listening on http://${host ?? '127.0.0.1'}:${port ?? 3333}/mcp`);
    return;
  }

  await serveStdio(createPayableMcpServer(payable, mcp));
  notify('listening on stdio');
}

function describeStartupError(error: unknown): string {
  if (isMissingMcpDependency(error)) {
    return MCP_DEPENDENCY_HINT;
  }
  return error instanceof Error ? error.message : String(error);
}

main().catch((error: unknown) => {
  notify(describeStartupError(error));
  process.exitCode = 1;
});
