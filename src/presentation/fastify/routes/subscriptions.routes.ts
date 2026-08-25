import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Payable } from '../../../payable';
import { requireRequestIdempotencyKey } from '../../shared/catalog-idempotency';
import {
  type ManageSubscriptionAction as ManageAction,
  runManageSubscription,
  runSubscriptionPriceMigrationAction,
  runSubscriptionPriceMigrationList,
  runSubscriptionPriceMigrationPreview,
  runSubscriptionPriceMigrationRetrieve,
  runSwapSubscription,
} from '../../shared/operations';
import {
  manageSubscriptionBodySchema,
  parseBody,
  subscriptionPriceMigrationIdParamSchema,
  subscriptionPriceMigrationListQuerySchema,
  subscriptionPriceMigrationOperationBodySchema,
  subscriptionPriceMigrationPreviewBodySchema,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import type { FastifyPayableOptions } from '../helpers';
import { DEFAULT_BODY_LIMIT, DEFAULT_ROUTE_RATE_LIMIT } from '../limits';

export async function registerSubscriptionRoutes(
  scope: FastifyInstance,
  payable: Payable,
  options: FastifyPayableOptions = {},
): Promise<void> {
  const manage = (action: ManageAction) => async (request: FastifyRequest, reply: FastifyReply) => {
    const body = parseBody(manageSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const tenantId = options.resolveTenant?.(request) ?? null;
    const result = await runManageSubscription(
      payable,
      action,
      params.name,
      body.billable,
      tenantId,
      options.resolveAuthorization?.(request),
    );
    reply.status(200).send(result);
  };

  const routeOptions = {
    bodyLimit: DEFAULT_BODY_LIMIT,
    config: { rateLimit: options.rateLimit ?? DEFAULT_ROUTE_RATE_LIMIT },
  };
  scope.post('/subscriptions/:name/cancel', routeOptions, manage('cancel'));
  scope.post('/subscriptions/:name/cancel-now', routeOptions, manage('cancelNow'));
  scope.post('/subscriptions/:name/resume', routeOptions, manage('resume'));
  scope.post('/subscriptions/:name/swap', routeOptions, async (request, reply) => {
    const body = parseBody(swapSubscriptionBodySchema, request.body);
    const params = request.params as { name: string };
    const tenantId = options.resolveTenant?.(request) ?? null;
    const result = await runSwapSubscription(
      payable,
      params.name,
      body,
      tenantId,
      options.resolveAuthorization?.(request),
    );
    reply.status(200).send(result);
  });

  scope.post('/canonical/subscription-price-migrations', routeOptions, async (request, reply) => {
    const body = parseBody(subscriptionPriceMigrationPreviewBodySchema, request.body);
    reply
      .status(200)
      .send(
        await runSubscriptionPriceMigrationPreview(
          payable,
          body,
          options.resolveTenant?.(request) ?? null,
          options.resolveAuthorization?.(request),
          requestIdempotencyKey(request),
        ),
      );
  });
  scope.get('/canonical/subscription-price-migrations', async (request, reply) => {
    const input = parseBody(subscriptionPriceMigrationListQuerySchema, request.query);
    reply
      .status(200)
      .send(
        await runSubscriptionPriceMigrationList(
          payable,
          input,
          options.resolveTenant?.(request) ?? null,
          options.resolveAuthorization?.(request),
        ),
      );
  });
  scope.get('/canonical/subscription-price-migrations/:id', async (request, reply) => {
    const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, request.params);
    reply
      .status(200)
      .send(
        await runSubscriptionPriceMigrationRetrieve(
          payable,
          id,
          options.resolveTenant?.(request) ?? null,
          options.resolveAuthorization?.(request),
        ),
      );
  });
  for (const action of ['approve', 'cancel', 'retry'] as const) {
    scope.post(
      `/canonical/subscription-price-migrations/:id/${action}`,
      routeOptions,
      async (request, reply) => {
        parseBody(subscriptionPriceMigrationOperationBodySchema, request.body);
        const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, request.params);
        reply
          .status(200)
          .send(
            await runSubscriptionPriceMigrationAction(
              payable,
              action,
              id,
              options.resolveTenant?.(request) ?? null,
              options.resolveAuthorization?.(request),
              requestIdempotencyKey(request),
            ),
          );
      },
    );
  }
}

function requestIdempotencyKey(request: FastifyRequest): string {
  return requireRequestIdempotencyKey({
    headers: request.headers,
    rawHeaders: request.raw.rawHeaders,
  });
}
