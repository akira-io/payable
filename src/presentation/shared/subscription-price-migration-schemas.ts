import { z } from 'zod';
import { SUBSCRIPTION_PRICE_MIGRATION_STATUSES } from '../../domain/value-objects/subscription-price-migration-status';
import { MAX_LIST_LIMIT, rfc3339DateTimeSchema } from './schema-primitives';

const subscriptionPriceMigrationPreviewBaseShape = {
  subscriptionId: z.string().min(1),
  targetPriceId: z.string().min(1),
  itemId: z.string().min(1).optional(),
  quantity: z.number().int().positive().optional(),
  prorationPolicy: z.enum([
    'prorateImmediately',
    'prorateAtNextRenewal',
    'chargeFullImmediately',
    'chargeFullAtNextRenewal',
    'none',
  ]),
  paymentFailurePolicy: z.enum(['preventChange', 'applyChange']),
};

export function createSubscriptionPriceMigrationPreviewSchema<Extra extends z.ZodRawShape>(
  extraShape: Extra,
) {
  return z.discriminatedUnion('effectiveTiming', [
    z
      .object({
        ...subscriptionPriceMigrationPreviewBaseShape,
        effectiveTiming: z.literal('immediate'),
        ...extraShape,
      })
      .strict(),
    z
      .object({
        ...subscriptionPriceMigrationPreviewBaseShape,
        effectiveTiming: z.literal('nextRenewal'),
        ...extraShape,
      })
      .strict(),
    z
      .object({
        ...subscriptionPriceMigrationPreviewBaseShape,
        effectiveTiming: z.literal('scheduled'),
        effectiveAt: rfc3339DateTimeSchema,
        ...extraShape,
      })
      .strict(),
  ]);
}

export const subscriptionPriceMigrationPreviewBodySchema =
  createSubscriptionPriceMigrationPreviewSchema({});

export const subscriptionPriceMigrationListInputShape = {
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  subscriptionId: z.string().min(1).optional(),
  status: z.enum(SUBSCRIPTION_PRICE_MIGRATION_STATUSES).optional(),
};

export const subscriptionPriceMigrationListQuerySchema = z
  .object(subscriptionPriceMigrationListInputShape)
  .strict();

export const subscriptionPriceMigrationIdParamSchema = z.object({ id: z.string().min(1) }).strict();

export const subscriptionPriceMigrationOperationBodySchema = z.object({}).strict();
