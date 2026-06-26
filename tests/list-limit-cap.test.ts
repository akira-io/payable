import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { limitShape } from '../src/presentation/mcp/schemas';
import {
  listInvoicesQuerySchema,
  listRefundsQuerySchema,
  listSubscriptionsQuerySchema,
  MAX_LIST_LIMIT,
} from '../src/presentation/shared/schemas';

describe('list limit cap', () => {
  it('accepts a limit at the cap and rejects one above it on shared query schemas', () => {
    expect(
      listInvoicesQuerySchema.parse({
        billableType: 'User',
        billableId: '1',
        limit: MAX_LIST_LIMIT,
      }).limit,
    ).toBe(MAX_LIST_LIMIT);
    expect(() =>
      listSubscriptionsQuerySchema.parse({
        billableType: 'User',
        billableId: '1',
        limit: MAX_LIST_LIMIT + 1,
      }),
    ).toThrow();
    expect(() => listRefundsQuerySchema.parse({ paymentId: 'pay_1', limit: 1_000_000 })).toThrow();
  });

  it('caps the mcp limit shape', () => {
    const schema = z.object(limitShape);
    expect(schema.parse({ limit: MAX_LIST_LIMIT }).limit).toBe(MAX_LIST_LIMIT);
    expect(() => schema.parse({ limit: MAX_LIST_LIMIT + 1 })).toThrow();
  });
});
