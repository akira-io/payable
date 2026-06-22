import type { IncomingHttpHeaders } from 'node:http';

export const PAYABLE_INSTANCE = Symbol('payable.instance');
export const PAYABLE_OPTIONS = Symbol('payable.options');

export interface NestPayableOptions {
  webhookSignatureHeader?: string;
}

export interface PayableHttpRequest {
  headers: IncomingHttpHeaders;
  body?: unknown;
  rawBody?: Buffer;
}

export function flattenHeaders(headers: IncomingHttpHeaders): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.join(',');
      continue;
    }
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
