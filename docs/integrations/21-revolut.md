# Revolut Provider

`RevolutProvider` (`src/infrastructure/providers/revolut/revolut-provider.ts`) implements the
Merchant API payment flow that fits Payable's current `PaymentProvider` contract: amount-based hosted
checkout orders, amount-based refunds, signed webhooks, and payment webhook reconciliation.

It does not implement Revolut Business API/Treasury features. Accounts, balances, counterparties,
transfers, FX, banking transactions, cards, team, and accounting belong in a separate future track, not
inside `PaymentProvider`.

## Construction and options

```ts
export interface RevolutProviderOptions {
  secretKey: string;
  webhookSecret: string;
  environment?: 'sandbox' | 'production';
  baseUrl?: string;
  apiVersion?: string;
  webhookToleranceMs?: number;
  logger?: Logger;
  fetch?: RevolutFetch;
}

new RevolutProvider(options: RevolutProviderOptions);
```

- `secretKey` - Merchant API secret key sent as `Authorization: Bearer <key>`.
- `webhookSecret` - Merchant webhook signing secret returned when creating or retrieving a Revolut
  webhook.
- `environment` - `production` by default; `sandbox` uses `https://sandbox-merchant.revolut.com`.
- `baseUrl` - optional override for tests or custom routing.
- `apiVersion` - defaults to `2026-04-20`, sent as `Revolut-Api-Version`.
- `webhookToleranceMs` - defaults to 5 minutes for replay protection.
- `logger` - forwarded to the Revolut event normalizer.
- `fetch` - optional injected HTTP client for tests. Production uses Node 20's global `fetch`.

```ts
import { createPayable, RevolutProvider } from '@akira-io/payable';

const payable = createPayable({
  providers: {
    revolut: new RevolutProvider({
      secretKey: process.env.REVOLUT_MERCHANT_SECRET_KEY!,
      webhookSecret: process.env.REVOLUT_WEBHOOK_SECRET!,
      environment: 'sandbox',
    }),
  },
  storage,
});
```

No SDK or peer dependency is required for the Merchant core provider.

## Declared capabilities

```ts
capabilities(): ProviderCapabilities {
  return new Set(['checkout', 'refunds', 'webhooks']);
}
```

The provider also implements `PaymentWebhookCapable`, so verified Revolut order events can reconcile
local pending payments by `order_id`.

It intentionally does not declare `customers`, `catalog`, `subscriptions`, `charges`, `billingPortal`,
or `invoicePdf` in this phase.

## Checkout

Revolut Merchant orders require an explicit amount and currency, so use Payable's amount-based redirect
checkout builder:

```ts
import { Money } from '@akira-io/payable';

const session = await payable
  .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' }, 'revolut')
  .redirectCheckout(Money.of(500, 'GBP'))
  .create({
    successUrl: 'https://shop.example/success',
    cancelUrl: 'https://shop.example/cancel',
    reference: 'order-42',
  });

// session.id  -> Revolut order id
// session.url -> Revolut hosted checkout URL
```

The provider calls `POST /api/orders` with:

```json
{
  "amount": 500,
  "currency": "GBP",
  "redirect_url": "https://shop.example/success"
}
```

`lineItems` and Payable catalog price ids are not sent to Revolut in this phase because the Merchant
order endpoint is amount-based. A subscription checkout request throws `PROVIDER_OPERATION_UNSUPPORTED`;
a checkout without `amount` throws `CHECKOUT_AMOUNT_REQUIRED`.

The OpenAPI spec for `POST /api/orders` does not declare `Idempotency-Key`, so the provider does not
invent that header for order creation. Payable's own idempotency layer still deduplicates the local
checkout operation.

## Refunds

Revolut refunds are created with `POST /api/orders/{order_id}/refund`. The endpoint requires amount and
currency, so `RefundInput.amount` is required for this provider:

```ts
await payable
  .customer(billable, 'revolut')
  .refund('6516e61c-d279-a454-a837-bc52ce55ed49', Money.of(100, 'GBP'), {
    reason: 'Returned item',
  });
```

The provider forwards `ctx.idempotencyKey` as `Idempotency-Key` for refunds because the Merchant API
declares that header on the refund endpoint.

Refund order states map to Payable refund statuses as:

| Revolut refund order state | Payable status |
| --- | --- |
| `pending`, `processing`, `authorised` | `pending` |
| `completed` | `succeeded` |
| `failed`, `cancelled` | `failed` |

## Webhooks

`RevolutProvider` implements `WebhookCapable`.

`verifyWebhook(input)` verifies:

- `Revolut-Request-Timestamp`
- `Revolut-Signature`
- HMAC SHA-256 signature over `v1.{timestamp}.{rawPayload}`
- 5 minute timestamp tolerance by default

The raw payload must be passed unmodified, the same as Stripe and Paddle. On signature failure the
provider throws `InvalidWebhookSignatureError`.

Revolut Merchant webhook payloads do not include a dedicated event id. Payable derives a stable
`providerEventId` as `revolut_` plus the SHA-256 hash of the raw payload, which makes retries of the
same raw event deduplicate in storage.

The request handler should pass the Revolut headers through:

```ts
await payable.receiveWebhook({
  provider: 'revolut',
  payload: rawBody,
  signature: req.headers['revolut-signature'],
  headers: {
    'Revolut-Request-Timestamp': req.headers['revolut-request-timestamp'],
  },
});
```

## Event normalization

| Revolut event | Normalized name |
| --- | --- |
| `ORDER_COMPLETED` | `payment.succeeded` |
| `ORDER_FAILED` | `payment.failed` |
| `ORDER_PAYMENT_DECLINED` | `payment.failed` |
| `ORDER_PAYMENT_FAILED` | `payment.failed` |
| `SUBSCRIPTION_INITIATED` | `subscription.created` |
| `SUBSCRIPTION_CANCELLED` | `subscription.cancelled` |
| `SUBSCRIPTION_FINISHED` | `subscription.cancelled` |
| `SUBSCRIPTION_OVERDUE` | `invoice.payment_failed` |

Unmapped events normalize to `null` and are still stored.

## Payment reconciliation

`reconcilePayment(verified)` maps verified order events to local `Payment` rows by Revolut `order_id`:

| Revolut event | Payable payment status |
| --- | --- |
| `ORDER_COMPLETED` | `succeeded` |
| `ORDER_FAILED` | `failed` |
| `ORDER_PAYMENT_DECLINED` | `failed` |
| `ORDER_PAYMENT_FAILED` | `failed` |
| `ORDER_CANCELLED` | `canceled` |

Subscription webhook reconciliation intentionally returns `null` in this phase. Revolut subscriptions
need a separate provider phase before Payable should create or update local subscription records from
those events.

## Error handling

Non-2xx Merchant API responses are converted to `PayableError` at the provider boundary:

| Revolut code | Payable code |
| --- | --- |
| `unauthenticated`, `unauthorized`, `forbidden` | `PROVIDER_AUTH_FAILED` |
| `bad_request`, `validation_error` | `PROVIDER_REQUEST_INVALID` |
| `too_many_requests`, `rate_limit_exceeded` | `PROVIDER_RATE_LIMITED` |
| `idempotency_conflict` | `PROVIDER_IDEMPOTENCY_CONFLICT` |
| anything else | `PROVIDER_ERROR` |

The error context includes `{ provider: 'revolut', revolutCode, status }` and never includes secrets.

## Source references

This provider phase follows the official Revolut Merchant API version `2026-04-20`:

- Merchant OpenAPI: `revolut-engineering/revolut-openapi`, `json/merchant-2026-04-20.json`
- Merchant servers: `https://merchant.revolut.com`, `https://sandbox-merchant.revolut.com`
- Webhook signature docs: `Revolut-Request-Timestamp`, `Revolut-Signature`, HMAC SHA-256 over
  `v1.{timestamp}.{rawPayload}`

---

[Previous: SISP](20-sisp.md) · [Index](../00-index.md) · [Next: Storage (Knex)](../persistence/21-storage-knex.md)
