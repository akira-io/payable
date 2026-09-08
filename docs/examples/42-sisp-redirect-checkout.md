# SISP Redirect Checkout

Start a vinti4 payment, send the generated form to the browser, and reconcile the callback.

## Prerequisites

- `@akira-io/payable` and `@akira-io/sisp`
- SISP POS credentials and a public callback URL
- Payable storage: it holds both the payment ledger and the redirect correlations node-sisp
  verifies callbacks against

## Configuration

```ts
import { createPayable } from '@akira-io/payable';
import { SispProvider, payableSispCorrelationStore } from '@akira-io/payable/sisp';
import { storage } from './billing-storage';

const payable = createPayable({
  providers: {
    sisp: new SispProvider({
      posId: process.env.SISP_POS_ID ?? '',
      posAutCode: process.env.SISP_POS_AUT_CODE ?? '',
      correlation: payableSispCorrelationStore(storage),
      currency: '132',
      is3DSec: '0',
      urlMerchantResponse: 'https://shop.example.com/sisp/callback',
    }),
  },
  storage,
});
```

## Run the example

```ts
import { Money } from '@akira-io/payable';

const session = await payable
  .customer({ billableType: 'Order', billableId: 'order_42' }, 'sisp')
  .redirectCheckout(Money.of(150000, 'CVE'))
  .create({ reference: 'order_42' });

// Send session.html as the response body so the browser posts to vinti4.

// callbackBody is the gateway's POST body, verbatim.
const result = await payable.receiveRedirectCallback({
  provider: 'sisp',
  payload: callbackBody,
});
```

## Expected result

The checkout returns a merchant reference, gateway URL, and ready auto-submit HTML form. Payable
records a pending local payment plus the correlation row carrying the expected amount, then updates
the payment once node-sisp has checked the callback fingerprint and matched it against that row.

## Failure behavior

SISP supports only redirect checkout. Catalog checkout, subscriptions, charges, signed webhooks, and
refunds are unavailable. Storage is not optional here: without a correlation store the checkout is
refused with `CorrelationRequiredError`. A callback that is replayed, carries a different amount, or
fails its fingerprint throws `PROVIDER_SISP_INVALID_CALLBACK`, with the reason in the error context; a
correctly signed decline is not an error, it is a payment with status `failed`. See
[SISP Provider](../integrations/20-sisp.md).

---

[Previous: NestJS and Prisma](41-nestjs-prisma.md) | [Index](../00-index.md) | [Next: Revolut Merchant](43-revolut-merchant-checkout.md)
