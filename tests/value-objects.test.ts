import { describe, expect, it } from 'vitest';
import { CorrelationId } from '../src/domain/value-objects/correlation-id';
import { IdempotencyKey } from '../src/domain/value-objects/idempotency-key';
import { ProviderName } from '../src/domain/value-objects/provider-name';
import { TenantId } from '../src/domain/value-objects/tenant-id';

describe('ProviderName', () => {
  it('normalizes to lowercase', () => {
    expect(ProviderName.of('Stripe').toString()).toBe('stripe');
  });

  it('rejects invalid names', () => {
    expect(() => ProviderName.of('1bad')).toThrow(TypeError);
  });
});

describe('IdempotencyKey', () => {
  it('builds deterministic charge keys', () => {
    const key = IdempotencyKey.forCharge({
      provider: 'stripe',
      billableType: 'User',
      billableId: '1',
      reference: 'invoice_123',
      amount: 9900,
      currency: 'USD',
    });
    expect(key.toString()).toBe('charge:stripe:User:1:invoice_123:9900:USD');
  });

  it('builds deterministic webhook keys', () => {
    expect(
      IdempotencyKey.forWebhook({ provider: 'stripe', providerEventId: 'evt_1' }).toString(),
    ).toBe('webhook:stripe:evt_1');
  });

  it('rejects empty keys', () => {
    expect(() => IdempotencyKey.of('  ')).toThrow(TypeError);
  });

  it('does not collide when a component contains the separator', () => {
    const base = { provider: 'stripe', billableType: 'User', billableId: '1', currency: 'USD' };
    const a = IdempotencyKey.forCharge({ ...base, reference: 'a:100', amount: 5 }).toString();
    const b = IdempotencyKey.forCharge({ ...base, reference: 'a', amount: 100 }).toString();
    expect(a).not.toBe(b);
    expect(a).toContain('a%3A100');
  });

  it('normalizes currency case so it does not split the dedup key', () => {
    const base = {
      provider: 'stripe',
      billableType: 'User',
      billableId: '1',
      reference: 'invoice_123',
      amount: 9900,
    };
    const upper = IdempotencyKey.forCharge({ ...base, currency: 'USD' }).toString();
    const lower = IdempotencyKey.forCharge({ ...base, currency: 'usd' as 'USD' }).toString();
    expect(lower).toBe(upper);
    expect(
      IdempotencyKey.forRefund({
        provider: 'stripe',
        paymentId: 'pi_1',
        amount: 100,
        currency: 'eur' as 'EUR',
      }).toString(),
    ).toBe('refund:stripe:pi_1:100:EUR');
  });

  it('rejects non-finite amounts', () => {
    const base = {
      provider: 'stripe',
      billableType: 'User',
      billableId: '1',
      reference: 'r',
      currency: 'USD' as const,
    };
    expect(() => IdempotencyKey.forCharge({ ...base, amount: Number.NaN })).toThrow(TypeError);
    expect(() => IdempotencyKey.forCharge({ ...base, amount: Number.POSITIVE_INFINITY })).toThrow(
      TypeError,
    );
    expect(() =>
      IdempotencyKey.forRefund({
        provider: 'stripe',
        paymentId: 'pi_1',
        amount: Number.NaN,
        currency: 'USD',
      }),
    ).toThrow(TypeError);
  });

  it('escapes the separator in customer and billing-portal keys', () => {
    const parts = { provider: 'stripe', billableType: 'User', billableId: 'a:b' };
    expect(IdempotencyKey.forCustomer(parts).toString()).toBe('customer:stripe:User:a%3Ab');
    expect(IdempotencyKey.forBillingPortal(parts).toString()).toBe('portal:stripe:User:a%3Ab');
  });
});

describe('CorrelationId', () => {
  it('generates a unique value', () => {
    expect(CorrelationId.generate().toString()).not.toBe(CorrelationId.generate().toString());
  });

  it('wraps an explicit value', () => {
    expect(CorrelationId.of('corr_1').toString()).toBe('corr_1');
  });
});

describe('TenantId', () => {
  it('rejects empty values', () => {
    expect(() => TenantId.of('')).toThrow(TypeError);
  });
});
