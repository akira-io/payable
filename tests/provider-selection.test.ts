import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { ProviderNotFoundError } from '../src/domain/errors/provider-not-found.error';
import { FakeProvider } from './support/fake-provider';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };
const urls = { successUrl: 'https://app.test/s', cancelUrl: 'https://app.test/c' };

describe('provider selection', () => {
  it('targets a named provider', async () => {
    const stripe = new FakeProvider();
    const secondary = new FakeProvider();
    const payable = createPayable({ providers: { stripe, secondary } });

    await payable
      .customer(billable, 'secondary')
      .newSubscription('default')
      .price('price_pro')
      .checkout(urls);

    expect(secondary.lastCheckout).toBeDefined();
    expect(stripe.lastCheckout).toBeUndefined();
  });

  it('defaults to the first registered provider', async () => {
    const stripe = new FakeProvider();
    const secondary = new FakeProvider();
    const payable = createPayable({ providers: { stripe, secondary } });

    await payable.customer(billable).newSubscription('default').price('price_pro').checkout(urls);

    expect(stripe.lastCheckout).toBeDefined();
    expect(secondary.lastCheckout).toBeUndefined();
  });

  it('throws for an unknown provider name', () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() } });
    expect(() => payable.customer(billable, 'unknown')).toThrow(ProviderNotFoundError);
  });
});
