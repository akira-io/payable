import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { FakeProvider } from './support/fake-provider';

function stripeChargeExampleFromDocs() {
  const stripe = new StripeProvider({
    secretKey: 'sk_test_example',
    webhookSecret: 'whsec_example',
  });
  const payable = createPayable({ providers: { stripe } });
  return () =>
    payable
      .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' })
      .charge({ amount: Money.of(1500, 'USD'), reference: 'order-1' });
}

async function multiProviderCheckoutExampleFromDocs() {
  const stripe = new FakeProvider();
  const paddle = new FakeProvider();
  const payable = createPayable({ providers: { stripe, paddle } });

  const session = await payable
    .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' }, 'paddle')
    .newSubscription('default')
    .price('pri_paddle_pro')
    .checkout({
      successUrl: 'https://app.example.com/billing/success',
      cancelUrl: 'https://app.example.com/billing',
    });

  return { paddle, session, stripe };
}

describe('documentation examples stay executable', () => {
  it('typechecks the Stripe charge example from docs/integrations/18-stripe.md', () => {
    expect(stripeChargeExampleFromDocs()).toBeTypeOf('function');
  });

  it('executes the named-provider checkout from docs/examples/36-multi-provider.md', async () => {
    const { paddle, session, stripe } = await multiProviderCheckoutExampleFromDocs();

    expect(session.url).toBe('https://fake.test/cs');
    expect(paddle.lastCheckout?.input.lineItems).toEqual([
      { priceId: 'pri_paddle_pro', quantity: 1 },
    ]);
    expect(stripe.lastCheckout).toBeUndefined();
  });
});
