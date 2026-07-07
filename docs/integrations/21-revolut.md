# Revolut Provider

`RevolutProvider` (`src/infrastructure/providers/revolut/revolut-provider.ts`) implements the Merchant
API flow that fits Payable's current `PaymentProvider` contract: amount checkout orders, subscription
setup orders, direct subscriptions, refunds, signed webhooks, and payment/subscription reconciliation.
Business API/Treasury features remain outside `PaymentProvider`.

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

No SDK or peer dependency is required.

## Declared capabilities

```ts
capabilities(): ProviderCapabilities {
  return new Set(['checkout', 'refunds', 'webhooks', 'subscriptions']);
}
```

The provider also implements `PaymentWebhookCapable`, so verified Revolut order events can reconcile
local pending payments by `order_id`.

It implements `DirectSubscriptionCapable` and `SubscriptionManagementCapable` with the limitations below.
It intentionally does not declare `customers`, `catalog`, `charges`, `billingPortal`, or `invoicePdf`.

## Payment Checkout

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
order endpoint is amount-based. A payment checkout without `amount` throws `CHECKOUT_AMOUNT_REQUIRED`.

The OpenAPI spec for `POST /api/orders` does not declare `Idempotency-Key`, so the provider does not
invent that header for order creation. Payable's own idempotency layer still deduplicates the local
checkout operation.

## Subscription Checkout

For Revolut Hosted Payment Page subscription setup, use the normal catalog checkout builder with
`mode('subscription')`. Payable maps the first line item's `priceId` to Revolut
`plan_variation_id`:

```ts
const session = await payable
  .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' }, 'revolut')
  .checkout()
  .mode('subscription')
  .addPrice('revolut_plan_variation_id')
  .create({
    successUrl: 'https://shop.example/subscription/setup/complete',
    cancelUrl: 'https://shop.example/account',
  });

// session.id  -> Revolut setup order id
// session.url -> Revolut Hosted Payment Page URL
```

The provider calls `POST /api/subscriptions` with `plan_variation_id`, `customer_id`,
`setup_order_redirect_url`, and optional `trial_duration`, then retrieves
`GET /api/orders/{setup_order_id}` for the setup order `checkout_url`.

The subscription checkout path supports exactly one plan variation with quantity `1`. Multi-item
subscriptions, quantity changes, and coupons throw `ProviderCapabilityNotSupportedError` because
Revolut subscription plans carry those details in the plan variation, not in Payable line items.

## Direct Subscriptions

`createSubscription(input, ctx)` is supported through Revolut `POST /api/subscriptions`.

Payable maps:

| Payable input | Revolut field |
| --- | --- |
| `providerCustomerId` | `customer_id` |
| `priceId` | `plan_variation_id` |
| `trialDays` | `trial_duration` as `P{days}D` |

The returned `SubscriptionDTO` maps Revolut states as:

| Revolut state | Payable status |
| --- | --- |
| `pending` | `incomplete` |
| `active` | `active` |
| `overdue` | `past_due` |
| `paused` | `paused` |
| `cancelled`, `finished` | `canceled` |

The Merchant response omits the current cycle end date, so `currentPeriodEnd` is `null`;
`trial_end_date` still maps to `trialEndsAt`.

## Subscription Management

`updateSubscription(input, ctx)` supports plan changes only. When `priceId` is provided, the provider
calls `POST /api/subscriptions/{subscription_id}/change-plan` with:

```json
{
  "plan_variation_id": "new_revolut_plan_variation_id",
  "scheduled": "at_cycle_end"
}
```

The endpoint returns `204`; the provider then retrieves `GET /api/subscriptions/{subscription_id}`
and maps the response to `SubscriptionDTO`.

`cancelSubscription(input, ctx)` supports only `immediately: true`, the path used by
`cancelSubscriptionNow`. Period-end cancellation is not equivalent, so `immediately: false` throws
`ProviderCapabilityNotSupportedError`.

`resumeSubscription` throws `ProviderCapabilityNotSupportedError` because the Merchant API does not
provide a resume endpoint.

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

`verifyWebhook(input)` verifies `Revolut-Request-Timestamp`, `Revolut-Signature`, HMAC SHA-256 over
`v1.{timestamp}.{rawPayload}`, and 5 minute timestamp tolerance by default.

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

## Subscription Reconciliation

`reconcileSubscription(verified)` maps verified subscription events to local subscriptions by
`subscription_id`:

| Revolut event | Payable subscription status |
| --- | --- |
| `SUBSCRIPTION_INITIATED` | `incomplete` |
| `SUBSCRIPTION_CANCELLED` | `canceled` |
| `SUBSCRIPTION_FINISHED` | `canceled` |
| `SUBSCRIPTION_OVERDUE` | `past_due` |

`currentPeriodEnd` and `trialEndsAt` are `null` for webhook-only reconciliation because the webhook
payload contains the subscription id and event type, not the full subscription object.

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
- Subscription endpoints: `POST /api/subscriptions`, `POST /api/subscriptions/{id}/change-plan`,
  `POST /api/subscriptions/{id}/cancel`
- Webhook signature docs: `Revolut-Request-Timestamp`, `Revolut-Signature`, HMAC SHA-256 over
  `v1.{timestamp}.{rawPayload}`

---

[Previous: SISP](20-sisp.md) · [Index](../00-index.md) · [Next: Storage (Knex)](../persistence/21-storage-knex.md)
