import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

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

describe('documentation examples stay executable', () => {
  it('typechecks the Stripe charge example from docs/integrations/18-stripe.md', () => {
    expect(stripeChargeExampleFromDocs()).toBeTypeOf('function');
  });
});
