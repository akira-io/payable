# Stripe Checkout

Create a Stripe-hosted subscription checkout and redirect the customer to the returned URL.

## Prerequisites

- Node.js 20 or newer
- `@akira-io/payable` and `stripe`
- Stripe secret key, webhook signing secret, and a recurring price ID

## Configuration

```ts
import { createPayable, StripeProvider } from '@akira-io/payable';

const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
  },
});
```

Add a storage driver before using webhooks, refunds, or subscription management. See
[Getting Started](../03-getting-started.md) for the complete setup.

## Run the example

```ts
const billable = {
  billableType: 'User',
  billableId: 'user_42',
  email: 'jane@example.com',
};

const session = await payable
  .customer(billable, 'stripe')
  .newSubscription('default')
  .price('price_pro_monthly')
  .trialDays(14)
  .checkout({
    successUrl: 'https://app.example.com/billing/success',
    cancelUrl: 'https://app.example.com/billing',
    reference: 'signup_user_42',
  });

return Response.redirect(session.url, 303);
```

## Expected result

Stripe returns a checkout session. `session.id` is the provider session ID and `session.url` is the
hosted page to which the application should redirect the customer.

## Failure behavior

An empty price fails with `CHECKOUT_PRICE_REQUIRED`. Stripe API errors propagate to the caller. Do
not retry an ambiguous response with a different billable, price, or subscription name because those
fields form Payable's idempotency key. See [Stripe Provider](../integrations/18-stripe.md) for webhook
and recovery details.

---

[Index](../00-index.md) | [Next: Multiple Providers](36-multi-provider.md)
