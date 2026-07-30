# Multiple Payment Providers

Register Stripe and Paddle in one Payable instance, then choose the provider for each customer flow.

## Prerequisites

- `@akira-io/payable`, `stripe`, and `@paddle/paddle-node-sdk`
- Stripe and Paddle API credentials
- Provider-specific price IDs for every plan offered by the application

## Configuration

```ts
import { createPayable, PaddleProvider, StripeProvider } from '@akira-io/payable';
import { storage } from './billing-storage';

const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
    paddle: new PaddleProvider({
      apiKey: process.env.PADDLE_API_KEY ?? '',
      webhookSecret: process.env.PADDLE_WEBHOOK_SECRET ?? '',
      environment: 'sandbox',
    }),
  },
  storage,
});
```

The first registered provider is the default. Pass a provider name explicitly when the choice is a
business decision or comes from customer input.

## Run the example

```ts
const billable = {
  billableType: 'Organization',
  billableId: 'org_42',
  email: 'billing@example.com',
};

const customerRegion = request.headers.get('x-customer-region');
const selectedProvider = customerRegion === 'EU' ? 'paddle' : 'stripe';
const prices = {
  stripe: 'price_stripe_pro',
  paddle: 'pri_paddle_pro',
} as const;

const session = await payable
  .customer(billable, selectedProvider)
  .newSubscription('default')
  .price(prices[selectedProvider])
  .checkout({
    successUrl: 'https://app.example.com/billing/success',
    cancelUrl: 'https://app.example.com/billing',
  });
```

Use the provider-qualified webhook endpoint in an adapter, such as
`POST /billing/webhooks/stripe` and `POST /billing/webhooks/paddle`. Stored payments and subscriptions
retain their provider, so later refunds and subscription changes route back to the original provider.

## Expected result

Only the selected provider receives the checkout request. Payable keeps a unified local billing
ledger while preserving the provider name on each persisted resource.

## Failure behavior

An unknown provider name throws `ProviderNotFoundError`. Omitting the provider silently selects the
first registered entry, so avoid relying on registration order when customers can use more than one
provider. Paddle does not support direct charges, direct subscription creation, or partial refunds;
check capabilities before exposing provider-independent actions.

---

[Previous: Stripe Checkout](35-stripe-checkout.md) | [Index](../00-index.md) | [Next: Subscriptions](37-subscriptions.md)
