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

  it('recurses into nested objects and arrays', () => {
    const result = redactContext({
      request: { authorization: 'Bearer x', path: '/charge' },
      headers: [{ cookie: 'a=b' }, { 'x-id': '1' }],
    });
    const request = result.request as { authorization: string; path: string };
    const headers = result.headers as Array<Record<string, string>>;
    expect(request.authorization).toBe('[redacted]');
    expect(request.path).toBe('/charge');
    expect(headers[0]?.cookie).toBe('[redacted]');
    expect(headers[1]?.['x-id']).toBe('1');
  });

  it('does not overflow on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { id: 1 };
    cyclic.self = cyclic;
    const result = redactContext({ cyclic });
    expect((result.cyclic as { id: number }).id).toBe(1);
    expect((result.cyclic as { self: unknown }).self).toBe('[circular]');
  });
});
