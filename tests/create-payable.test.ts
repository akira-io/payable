import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { ProviderNotFoundError } from '../src/domain/errors/provider-not-found.error';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { SystemClock } from '../src/support/clock/system-clock';

const provider = () => new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' });

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

  it('allows providers to be omitted', () => {
    const payable = createPayable({});

    expect(payable.providers().names()).toEqual([]);
  });

  it('allows an empty provider registry', () => {
    const payable = createPayable({ providers: {} });

    expect(payable.providers().names()).toEqual([]);
  });

  it('fails provider-bound access with a coded error when no provider is registered', () => {
    const payable = createPayable({});

    expect(() => payable.customer({ billableType: 'User', billableId: '1' })).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' }),
    );
  });

  it('reports the missing provider before a missing tenant for provider-bound access', () => {
    const payable = createPayable({ tenant: { enabled: true } });

    expect(() => payable.customer({ billableType: 'User', billableId: '1' })).toThrowError(
      expect.objectContaining({ code: 'PROVIDER_NOT_FOUND' }),
    );
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
});
