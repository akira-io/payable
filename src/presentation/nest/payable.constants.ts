import type { IncomingHttpHeaders } from 'node:http';
import type { CanActivate, Type } from '@nestjs/common';

export { flattenHeaders } from '../shared/payable-http';

export const PAYABLE_INSTANCE = Symbol('payable.instance');
export const PAYABLE_OPTIONS = Symbol('payable.options');

export interface NestPayableOptions {
  webhookSignatureHeader?: string;
  authenticate?: Type<CanActivate>;
}

export interface PayableHttpRequest {
  headers: IncomingHttpHeaders;
  body?: unknown;
  rawBody?: Buffer;
}
