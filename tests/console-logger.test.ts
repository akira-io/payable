import { describe, expect, it } from 'vitest';
import { redactContext } from '../src/support/logger/console-logger';

describe('ConsoleLogger redaction', () => {
  it('redacts sensitive keys and keeps the rest', () => {
    const result = redactContext({
      authorization: 'Bearer x',
      apiKey: 'sk_live_1',
      'stripe-signature': 'sig',
      password: 'hunter2',
      paymentId: 'pay_1',
      amount: 100,
    });
    expect(result.authorization).toBe('[redacted]');
    expect(result.apiKey).toBe('[redacted]');
    expect(result['stripe-signature']).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
    expect(result.paymentId).toBe('pay_1');
    expect(result.amount).toBe(100);
  });
});
