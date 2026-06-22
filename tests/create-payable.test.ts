import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { ProviderNotFoundError } from '../src/domain/errors/provider-not-found.error';
import { Money } from '../src/domain/value-objects/money';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { SystemClock } from '../src/support/clock/system-clock';

const provider = () => new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' });
const billable = { billableType: 'User', billableId: '1', email: 'user@example.com' };

describe('createPayable', () => {
  it('wires default clock and event bus', () => {
    const payable = createPayable({ providers: { stripe: provider() } });
    expect(payable.clock()).toBeInstanceOf(SystemClock);
    expect(payable.events()).toBeInstanceOf(InMemoryEventBus);
    expect(payable.tenantEnabled()).toBe(false);
  });

  it('honors tenant configuration', () => {
    const payable = createPayable({
      tenant: { enabled: true },
      providers: { stripe: provider() },
    });
    expect(payable.tenantEnabled()).toBe(true);
  });

  it('exposes the provider registry', () => {
    const payable = createPayable({ providers: { stripe: provider() } });
    expect(payable.providers().has('stripe')).toBe(true);
    expect(payable.providers().get('stripe').name).toBe('stripe');
    expect(() => payable.providers().get('paddle')).toThrow(ProviderNotFoundError);
  });

  it('requires at least one provider', () => {
    expect(() => createPayable({ providers: {} })).toThrow(TypeError);
  });

  it('rejects an invalid idempotency strategy', () => {
    expect(() =>
      createPayable({
        providers: { stripe: provider() },
        // @ts-expect-error invalid strategy on purpose
        idempotency: { strategy: 'sometimes' },
      }),
    ).toThrow();
  });

  it('returns not-implemented for later-phase fluent terminals', async () => {
    const payable = createPayable({ providers: { stripe: provider() } });
    await expect(
      payable.customer(billable).charge({ amount: Money.of(9900, 'USD') }),
    ).rejects.toThrow('Not implemented');
    await expect(payable.customer(billable).subscription('default').cancel()).rejects.toThrow(
      'Not implemented',
    );
    await expect(payable.refund({ paymentId: 'pay_1' })).rejects.toThrow('Not implemented');
  });
});
