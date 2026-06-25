import type { IncomingHttpHeaders } from 'node:http';
import type { CanActivate, Type } from '@nestjs/common';
import type { AuthorizationContext } from '../../application/policies/authorization-context';

export { flattenHeaders } from '../shared/payable-http';

export const PAYABLE_INSTANCE = Symbol('payable.instance');
export const PAYABLE_OPTIONS = Symbol('payable.options');

export interface PayableHttpRequest {
  headers: IncomingHttpHeaders;
  body?: unknown;
  rawBody?: Buffer;
}

export interface NestPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: Type<CanActivate>;
  resolveTenant?: (request: PayableHttpRequest) => string | null | undefined;
  resolveAuthorization?: (request: PayableHttpRequest) => AuthorizationContext | undefined;
}

export function resolveTenantId(
  options: NestPayableOptions,
  request: PayableHttpRequest,
): string | null {
  return options.resolveTenant?.(request) ?? null;
}

export function resolveAuthorization(
  options: NestPayableOptions,
  request: PayableHttpRequest,
): AuthorizationContext | undefined {
  return options.resolveAuthorization?.(request);
}
