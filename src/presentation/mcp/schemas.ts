import { z } from 'zod';
import { Money } from '../../domain/value-objects/money';

export const billableObject = z.object({
  billableType: z.string().min(1),
  billableId: z.string().min(1),
  email: z.string().min(1),
  name: z.string().optional(),
});

export const moneyObject = z.object({
  amount: z.number().int().nonnegative(),
  currency: z.string().min(1),
});

export const tenantShape = {
  tenantId: z.string().nullable().optional(),
};

export const providerShape = {
  provider: z.string().optional(),
};

export const limitShape = {
  limit: z.number().int().positive().optional(),
};

export const recurringInterval = z.enum(['day', 'week', 'month', 'year']);

export function toMoney(input: z.infer<typeof moneyObject>): Money {
  return Money.of(input.amount, input.currency);
}
