import { z } from 'zod';
import { Money } from '../../domain/value-objects/money';
import { MAX_LIST_LIMIT } from '../shared/schemas';

export const billableObject = z.object({
  billableType: z.string().min(1),
  billableId: z.string().min(1),
  email: z.string().email(),
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
  limit: z.number().int().positive().max(MAX_LIST_LIMIT).optional(),
};

export const recurringInterval = z.enum(['day', 'week', 'month', 'year']);

export function toMoney(input: z.infer<typeof moneyObject>): Money {
  return Money.of(input.amount, input.currency);
}
