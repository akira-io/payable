#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Payable } from '../../payable';
import { createPayableMcpServer } from './index';
import type { McpPayableOptions } from './options';
import { serveHttp } from './transports/http';
import { serveStdio } from './transports/stdio';

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

async function loadConfig(path: string): Promise<PayableMcpConfig> {
  const module = await import(pathToFileURL(resolve(path)).href);
  const exported = module.default ?? module;
  if (exported && typeof exported === 'object' && 'payable' in exported) {
    return exported as PayableMcpConfig;
  }
  return { payable: exported as Payable };
}

function parseHost(value: string | boolean | undefined): { host?: string; port?: number } {
  if (typeof value !== 'string') {
    return {};
  }
  const [host, port] = value.split(':');
  return { host: host || undefined, port: port ? Number(port) : undefined };
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

  const httpFlag = readFlag('--http');
  if (httpFlag) {
    const { host, port } = parseHost(httpFlag);
    const token = process.env.PAYABLE_MCP_TOKEN;
    await serveHttp(() => createPayableMcpServer(payable, mcp), {
      host,
      port,
      authenticate: token
        ? (request) => request.headers.authorization === `Bearer ${token}`
        : undefined,
    });
    notify(`listening on http://${host ?? '127.0.0.1'}:${port ?? 3333}/mcp`);
    return;
  }

  await serveStdio(createPayableMcpServer(payable, mcp));
  notify('listening on stdio');
}

main().catch((error: unknown) => {
  notify(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
