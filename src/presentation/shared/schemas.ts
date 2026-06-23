import { z } from 'zod';
import { PayableError } from '../../domain/errors/payable-error';

export const billableSchema = z.object({
  billableType: z.string().min(1),
  billableId: z.string().min(1),
  email: z.string().min(1),
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
  successUrl: z.string().min(1),
  cancelUrl: z.string().min(1),
});

export const manageSubscriptionBodySchema = z.object({ billable: billableSchema });

export const swapSubscriptionBodySchema = z.object({
  billable: billableSchema,
  price: z.string().min(1),
});

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new PayableError('Request validation failed', {
      code: 'VALIDATION_FAILED',
      context: { issues: result.error.issues },
    });
  }
  return result.data;
}
