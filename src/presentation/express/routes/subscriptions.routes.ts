import type { Router } from 'express';
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
  billableLookupSchema,
  listSubscriptionsQuerySchema,
  manageSubscriptionBodySchema,
  parseBody,
  subscriptionPriceMigrationIdParamSchema,
  subscriptionPriceMigrationListQuerySchema,
  subscriptionPriceMigrationOperationBodySchema,
  subscriptionPriceMigrationPreviewBodySchema,
  swapSubscriptionBodySchema,
} from '../../shared/schemas';
import { SubscriptionMigrationMutationBoundary } from '../../shared/subscription-migration-boundary';
import { asyncHandler, type ExpressPayableOptions, jsonBody } from '../helpers';

export function registerSubscriptionRoutes(
  router: Router,
  payable: Payable,
  options: ExpressPayableOptions = {},
): void {
  const migrationBoundary = new SubscriptionMigrationMutationBoundary(
    options.subscriptionPriceMigrationLimits,
  );
  router.get(
    '/subscriptions',
    asyncHandler(async (req, res) => {
      const query = parseBody(listSubscriptionsQuerySchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const subscriptions = await payable
        .customer(
          { billableType: query.billableType, billableId: query.billableId },
          undefined,
          tenantId,
        )
        .subscriptions(query.limit ? { limit: query.limit } : undefined);
      res.status(200).json(subscriptions);
    }),
  );

  router.get(
    '/subscriptions/:name',
    asyncHandler(async (req, res) => {
      const query = parseBody(billableLookupSchema, req.query);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const subscription = await payable
        .customer({ ...query }, undefined, tenantId)
        .subscription(String(req.params.name))
        .get();
      if (!subscription) {
        res
          .status(404)
          .json({ error: 'SUBSCRIPTION_NOT_FOUND', message: 'Subscription not found' });
        return;
      }
      res.status(200).json(subscription);
    }),
  );

  const manage = (action: ManageAction) =>
    asyncHandler(async (req, res) => {
      const body = parseBody(manageSubscriptionBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const result = await runManageSubscription(
        payable,
        action,
        String(req.params.name),
        body.billable,
        tenantId,
        options.resolveAuthorization?.(req),
      );
      res.status(200).json(result);
    });

  router.post('/subscriptions/:name/cancel', jsonBody(), manage('cancel'));
  router.post('/subscriptions/:name/cancel-now', jsonBody(), manage('cancelNow'));
  router.post('/subscriptions/:name/resume', jsonBody(), manage('resume'));
  router.post(
    '/subscriptions/:name/swap',
    jsonBody(),
    asyncHandler(async (req, res) => {
      const body = parseBody(swapSubscriptionBodySchema, req.body);
      const tenantId = options.resolveTenant?.(req) ?? null;
      const result = await runSwapSubscription(
        payable,
        String(req.params.name),
        body,
        tenantId,
        options.resolveAuthorization?.(req),
      );
      res.status(200).json(result);
    }),
  );

  router.post(
    '/canonical/subscription-price-migrations',
    jsonBody(migrationBoundary.maxBodyBytes),
    asyncHandler(async (req, res) => {
      const body = parseBody(subscriptionPriceMigrationPreviewBodySchema, req.body);
      const access = mutationAccess(req, options, migrationBoundary);
      res
        .status(200)
        .json(
          await runSubscriptionPriceMigrationPreview(
            payable,
            body,
            access.tenantId,
            access.authorization,
            requireRequestIdempotencyKey({ headers: req.headers, rawHeaders: req.rawHeaders }),
          ),
        );
    }),
  );
  router.get(
    '/canonical/subscription-price-migrations',
    asyncHandler(async (req, res) => {
      const input = parseBody(subscriptionPriceMigrationListQuerySchema, req.query);
      res
        .status(200)
        .json(
          await runSubscriptionPriceMigrationList(
            payable,
            input,
            options.resolveTenant?.(req) ?? null,
            options.resolveAuthorization?.(req),
          ),
        );
    }),
  );
  router.get(
    '/canonical/subscription-price-migrations/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, req.params);
      res
        .status(200)
        .json(
          await runSubscriptionPriceMigrationRetrieve(
            payable,
            id,
            options.resolveTenant?.(req) ?? null,
            options.resolveAuthorization?.(req),
          ),
        );
    }),
  );
  for (const action of ['approve', 'cancel', 'retry'] as const) {
    router.post(
      `/canonical/subscription-price-migrations/:id/${action}`,
      jsonBody(migrationBoundary.maxBodyBytes),
      asyncHandler(async (req, res) => {
        parseBody(subscriptionPriceMigrationOperationBodySchema, req.body);
        const { id } = parseBody(subscriptionPriceMigrationIdParamSchema, req.params);
        const access = mutationAccess(req, options, migrationBoundary);
        res
          .status(200)
          .json(
            await runSubscriptionPriceMigrationAction(
              payable,
              action,
              id,
              access.tenantId,
              access.authorization,
              requireRequestIdempotencyKey({ headers: req.headers, rawHeaders: req.rawHeaders }),
            ),
          );
      }),
    );
  }
}

function mutationAccess(
  request: Parameters<NonNullable<ExpressPayableOptions['resolveTenant']>>[0],
  options: ExpressPayableOptions,
  boundary: SubscriptionMigrationMutationBoundary,
) {
  const tenantId = options.resolveTenant?.(request) ?? null;
  const authorization = options.resolveAuthorization?.(request);
  boundary.enforceRate({
    tenantId,
    actorId: authorization?.actorId,
  });
  return { tenantId, authorization };
}
