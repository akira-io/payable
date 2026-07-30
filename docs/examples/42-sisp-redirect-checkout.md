# SISP Redirect Checkout

Start a vinti4 payment, send the generated form to the browser, and reconcile the callback.

## Prerequisites

- `@akira-io/payable`, `@akira-io/sisp`, and a Knex-compatible database driver
- SISP POS credentials and a public callback URL
- Payable storage for the normalized local payment ledger

## Configuration

```ts
import { createPayable } from '@akira-io/payable';
import { SispProvider } from '@akira-io/payable/sisp';
import { storage } from './billing-storage';

const payable = createPayable({
  providers: {
    sisp: new SispProvider({
      posId: process.env.SISP_POS_ID ?? '',
      posAutCode: process.env.SISP_POS_AUT_CODE ?? '',
      database: {
        client: 'better-sqlite3',
        connection: { filename: './sisp.db' },
        autoMigrate: true,
      },
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

const result = await payable.receiveRedirectCallback({
  provider: 'sisp',
  payload: callbackBody,
});
```

## Expected result

The checkout returns a merchant reference, gateway URL, and ready auto-submit HTML form. Payable
records a pending local payment and updates it after node-sisp validates the callback fingerprint.

## Failure behavior

SISP supports only redirect checkout. Catalog checkout, subscriptions, charges, signed webhooks, and
refunds are unavailable. Without Payable storage the form is returned but no local payment is saved.
Keep node-sisp's protocol database and Payable's ledger database available for reconciliation. See
[SISP Provider](../integrations/20-sisp.md).

---

[Previous: NestJS and Prisma](41-nestjs-prisma.md) | [Index](../00-index.md) | [Next: Revolut Merchant](43-revolut-merchant-checkout.md)
