import { z } from 'zod';
import { PayableError } from '../../domain/errors/payable-error';
import { Money } from '../../domain/value-objects/money';
import { PAYMENT_STATUSES } from '../../domain/value-objects/payment-status';
import { SUBSCRIPTION_STATUSES } from '../../domain/value-objects/subscription-status';

export const MAX_LIST_LIMIT = 100;

export const billableSchema = z.object({
  billableType: z.string().min(1),
  billableId: z.string().min(1),
  email: z.string().email(),
  name: z.string().optional(),
});

export const checkoutBodySchema = z.object({
  billable: billableSchema,
  subscription: z.object({
    name: z.string().min(1),
    price: z.string().min(1),
    trialDays: z.number().int().nonnegative().optional(),
    coupon: z.string().min(1).optional(),
  }),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export const customerBodySchema = z.object({ billable: billableSchema });

export const customerSyncBodySchema = z.object({
  provider: z.string().min(1),
  billable: billableSchema,
});

export const customerUpdateBodySchema = z.object({
  billable: billableSchema,
  email: z.string().email().optional(),
  name: z.string().min(1).optional(),
});

export const billableLookupSchema = z.object({
  billableType: z.string().min(1),
  billableId: z.string().min(1),
});

export const listInvoicesQuerySchema = billableLookupSchema.extend({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
});

export const listSubscriptionsQuerySchema = billableLookupSchema.extend({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
});

export const listRefundsQuerySchema = z.object({
  paymentId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
});

const booleanQuerySchema = z
  .union([z.boolean(), z.literal('true'), z.literal('false')])
  .transform<boolean>((value) => value === true || value === 'true');

const canonicalListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
});

export const canonicalCustomerListQuerySchema = canonicalListQuerySchema.extend({
  billableType: z.string().min(1).optional(),
  billableId: z.string().min(1).optional(),
  email: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  includeBindings: booleanQuerySchema.optional(),
});

export const canonicalProductListQuerySchema = canonicalListQuerySchema.extend({
  active: booleanQuerySchema.optional(),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  includeBindings: booleanQuerySchema.optional(),
});

export const canonicalPriceListQuerySchema = canonicalListQuerySchema.extend({
  active: booleanQuerySchema.optional(),
  productId: z.string().min(1).optional(),
  type: z.enum(['one_time', 'recurring']).optional(),
  lookupKey: z.string().min(1).optional(),
  lookupKeys: z
    .union([z.string().min(1), z.array(z.string().min(1)).min(1)])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional(),
  includeBindings: booleanQuerySchema.optional(),
});

export const canonicalSubscriptionListQuerySchema = canonicalListQuerySchema.extend({
  customerId: z.string().min(1).optional(),
  status: z.enum(SUBSCRIPTION_STATUSES).optional(),
  canonicalPriceId: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  includeBindings: booleanQuerySchema.optional(),
});

export const canonicalPaymentListQuerySchema = canonicalListQuerySchema.extend({
  customerId: z.string().min(1).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  currency: z.string().min(1).optional(),
  reference: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
});

export const catalogListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
  active: booleanQuerySchema.optional(),
});

export const priceListQuerySchema = catalogListQuerySchema.extend({
  providerProductId: z.string().min(1).optional(),
});

export const catalogIdParamSchema = z.object({ id: z.string().min(1) });

export const productBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export const productUpdateBodySchema = z.object({
  providerProductId: z.string().min(1),
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

export const priceBodySchema = z.object({
  providerProductId: z.string().min(1),
  amount: z.object({ amount: z.number().int(), currency: z.string().min(1) }),
  interval: z.enum(['day', 'week', 'month', 'year']).optional(),
  intervalCount: z.number().int().positive().optional(),
  description: z.string().min(1).optional(),
});

export const manageSubscriptionBodySchema = z.object({ billable: billableSchema });

export const subscriptionChangePoliciesSchema = z.object({
  effectiveTiming: z.enum(['immediate', 'nextRenewal', 'scheduled']),
  prorationPolicy: z.enum([
    'prorateImmediately',
    'prorateAtNextRenewal',
    'chargeFullImmediately',
    'chargeFullAtNextRenewal',
    'none',
  ]),
  paymentFailurePolicy: z.enum(['preventChange', 'applyChange']),
});

export const swapSubscriptionBodySchema = subscriptionChangePoliciesSchema.extend({
  billable: billableSchema,
  itemId: z.string().min(1).optional(),
  price: z.string().min(1),
});

export const refundBodySchema = z.object({
  paymentId: z.string().min(1),
  amount: z.object({ amount: z.number().int().positive(), currency: z.string().min(1) }).optional(),
  reason: z.string().min(1).optional(),
});

export function parseBody<TSchema extends z.ZodType>(
  schema: TSchema,
  body: unknown,
): z.output<TSchema> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new PayableError('Request validation failed', {
      code: 'VALIDATION_FAILED',
      context: {
        issues: result.error.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        })),
      },
    });
  }
  return result.data;
}

export function parseMoneyInput(input: { amount: number; currency: string }): Money {
  try {
    return Money.of(input.amount, input.currency);
  } catch (error) {
    throw new PayableError('Request validation failed', {
      code: 'VALIDATION_FAILED',
      context: { reason: error instanceof Error ? error.message : 'invalid money amount' },
    });
  }
}
