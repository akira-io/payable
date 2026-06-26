import { describe, expect, it } from 'vitest';
import { IdempotencyKey } from '../src/domain/value-objects/idempotency-key';

const chargeParts = {
  provider: 'stripe',
  billableType: 'User',
  billableId: '1',
  reference: 'ref-1',
  currency: 'USD' as const,
};

describe('IdempotencyKey amount validation', () => {
  it('accepts integer minor-unit amounts', () => {
    expect(IdempotencyKey.forCharge({ ...chargeParts, amount: 1500 }).toString()).toContain('1500');
  });

  it('rejects fractional charge amounts', () => {
    expect(() => IdempotencyKey.forCharge({ ...chargeParts, amount: 10.5 })).toThrow(TypeError);
  });

  it('rejects fractional refund amounts', () => {
    expect(() =>
      IdempotencyKey.forRefund({
        provider: 'stripe',
        paymentId: 'pay-1',
        amount: 10.5,
        currency: 'USD',
      }),
    ).toThrow(TypeError);
  });
});
