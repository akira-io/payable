import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { payableErrorStatus } from '../src/presentation/shared/payable-http';

describe('payableErrorStatus', () => {
  it('maps known domain error codes to their HTTP status', () => {
    const cases: Array<[string, number]> = [
      ['PAYMENT_NOT_FOUND', 404],
      ['WEBHOOK_EVENT_NOT_FOUND', 404],
      ['WEBHOOK_REPLAY_DENIED', 403],
      ['SUBSCRIPTION_PRICE_REQUIRED', 422],
      ['PROVIDER_CAPABILITY_NOT_SUPPORTED', 422],
    ];
    for (const [code, status] of cases) {
      expect(payableErrorStatus(new PayableError('x', { code }))).toBe(status);
    }
  });

  it('falls back to 500 for unknown codes and non-Payable errors', () => {
    expect(payableErrorStatus(new PayableError('x', { code: 'SOMETHING_ELSE' }))).toBe(500);
    expect(payableErrorStatus(new Error('boom'))).toBe(500);
  });
});
