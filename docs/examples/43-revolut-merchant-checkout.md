# Revolut Merchant Checkout

Create an amount-based Revolut Merchant order and redirect the customer to its hosted payment page.

## Prerequisites

- `@akira-io/payable`
- Revolut Merchant API secret and webhook signing secret
- A configured storage driver for local payment and webhook reconciliation

## Configuration

```ts
import { createPayable, RevolutProvider } from '@akira-io/payable';
import { storage } from './billing-storage';

const payable = createPayable({
  providers: {
    revolut: new RevolutProvider({
      secretKey: process.env.REVOLUT_MERCHANT_SECRET_KEY ?? '',
      webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET ?? '',
      environment: 'sandbox',
    }),
  },
  storage,
});
```

## Run the example

```ts
import { Money } from '@akira-io/payable';

const session = await payable
  .customer(
    { billableType: 'User', billableId: 'user_42', email: 'jane@example.com' },
    'revolut',
  )
  .redirectCheckout(Money.of(500, 'GBP'))
  .create({
    successUrl: 'https://shop.example.com/payment/complete',
    cancelUrl: 'https://shop.example.com/cart',
    reference: 'order_42',
  });

return Response.redirect(session.url, 303);
```

## Expected result

Revolut creates an order for GBP 5.00 and returns its hosted checkout URL. Payable records a pending
payment keyed by the Revolut order ID so signed Merchant webhooks can update its status.

## Failure behavior

A missing amount fails with `CHECKOUT_AMOUNT_REQUIRED`. Revolut does not support catalog line items
for one-time orders. Preserve `Revolut-Request-Timestamp`, `Revolut-Signature`, and the raw payload
when receiving webhooks. See [Revolut Provider](../integrations/21-revolut.md) for supported
subscription and refund variants.

---

[Previous: SISP](42-sisp-redirect-checkout.md) | [Index](../00-index.md) | [Next: MCP Server](44-mcp-server.md)
