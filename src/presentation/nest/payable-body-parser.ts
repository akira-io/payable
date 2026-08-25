import type { INestApplication } from '@nestjs/common';
import { PayableError } from '../../domain/errors/payable-error';
import { payableErrorBody, payableErrorStatus } from '../shared/payable-http';
import {
  type SubscriptionPriceMigrationLimits,
  subscriptionMigrationBodyLimit,
} from '../shared/subscription-migration-boundary';
import type { PayableHttpRequest } from './payable.constants';

const verifiedRequests = new WeakMap<object, number>();

export interface NestPayableBodyParserOptions {
  subscriptionPriceMigrationLimits?: SubscriptionPriceMigrationLimits;
  preserveRawBody?: boolean;
}

export function configureNestExpressPayableBodyParser(
  application: INestApplication,
  options: NestPayableBodyParserOptions = {},
): INestApplication {
  const adapter = application.getHttpAdapter();
  if (adapter.getType() !== 'express' || typeof adapter.useBodyParser !== 'function') {
    throw new Error('The configured Nest HTTP adapter is not the supported Express platform');
  }
  const bodyLimit = subscriptionMigrationBodyLimit(options.subscriptionPriceMigrationLimits);
  adapter.useBodyParser('json', false, {
    limit: bodyLimit,
    verify(request: PayableHttpRequest, _response: unknown, rawBody: Buffer) {
      verifiedRequests.set(request, bodyLimit);
      if (options.preserveRawBody !== false) request.rawBody = Buffer.from(rawBody);
    },
  });
  application.use(
    (
      error: unknown,
      _request: unknown,
      response: { status(code: number): { json(body: unknown): unknown } },
      next: (error: unknown) => void,
    ) => {
      if (payableErrorStatus(error) !== 413) {
        next(error);
        return;
      }
      response.status(413).json(payableErrorBody(error));
    },
  );
  return application;
}

export function assertNestPayableBodyParser(
  request: PayableHttpRequest,
  limits: SubscriptionPriceMigrationLimits = {},
): void {
  if (verifiedRequests.get(request) === subscriptionMigrationBodyLimit(limits)) return;
  throw new PayableError('The required Nest subscription migration body parser is not installed', {
    code: 'NEST_SUBSCRIPTION_MIGRATION_BODY_PARSER_REQUIRED',
  });
}
