import { PayableError } from '../../domain/errors/payable-error';

export function parsePort(port: string | undefined): number | undefined {
  if (!port) {
    return undefined;
  }
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new PayableError(`Invalid --http port: ${port}`, { code: 'MCP_INVALID_PORT' });
  }
  return parsed;
}

export function parseHost(value: string | boolean | undefined): { host?: string; port?: number } {
  if (typeof value !== 'string') {
    return {};
  }
  const bracketed = value.match(/^\[(.+)\](?::(\d+))?$/);
  if (bracketed) {
    return { host: bracketed[1], port: parsePort(bracketed[2]) };
  }
  if ((value.match(/:/g)?.length ?? 0) > 1) {
    return { host: value, port: undefined };
  }
  const [host, port] = value.split(':');
  return { host: host || undefined, port: parsePort(port) };
}

export function isLoopbackHost(host: string | undefined): boolean {
  return host === undefined || host === '127.0.0.1' || host === 'localhost' || host === '::1';
}
