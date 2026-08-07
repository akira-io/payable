# Paddle Provider

`PaddleProvider` (`src/infrastructure/providers/paddle/paddle-provider.ts`) implements the base
`PaymentProvider` contract. It implements catalog, subscription-management, lifecycle-pause, webhook,
customer, and billing-portal capability interfaces, but not `ChargeCapable`,
`DirectSubscriptionCapable`, or `InvoiceCapable`. Its registry `name` is `'paddle'`.

## Construction and options

```ts
export interface PaddleProviderOptions {
  apiKey: string;
  webhookSecret: string;
  environment?: 'sandbox' | 'production';
  logger?: Logger;
}

new PaddleProvider(options: PaddleProviderOptions, client?: PaddleClient);
```

- `apiKey` - the Paddle API key used to lazily construct the SDK client.
- `webhookSecret` - passed to `PaddleWebhookVerifier`.
- `environment` (optional) - selects the Paddle `sandbox` or `production` environment when constructing
  the SDK client.
- `logger` (optional) - a `Logger` forwarded to `PaddleEventNormalizer`.
- `client` (optional) - an injected `PaddleClient` for tests. When omitted, the SDK is loaded on first
  use via `import('@paddle/paddle-node-sdk')` and `new Paddle(apiKey)`, keeping the dependency optional.

`PaddleClient` is a narrow structural interface declared in `paddle-types.ts` rather than the full SDK
type. The provider only depends on the methods it calls (`customers`, `products`, `prices`,
`transactions`, `subscriptions`, `adjustments`, `customerPortalSessions`, `webhooks`).

## Declared capabilities

```ts
capabilities(): ProviderCapabilities {
  return new Set([
    'checkout',
    'subscriptions',
    'refunds',
    'billingPortal',
    'webhooks',
    'customers',
    'catalog',
    'catalogRead',
    'catalogLifecycle',
  ]);
}
```

### Capability gaps versus Stripe

Paddle's set omits `charges`, `trials`, `coupons`, `meteredBilling`, and `invoicePdf`. The differences
are:

- **No `invoicePdf`** (Stripe declares it). Paddle does not implement `InvoiceCapable`, so there is no
  `listInvoices` / `downloadInvoicePdf`. `isInvoiceCapable(paddleProvider)` returns `false`.
- **No `ChargeCapable`.** Paddle has no `charge` method; one-off direct charges are not available.
  `isChargeCapable(paddleProvider)` returns `false`.
- **No `DirectSubscriptionCapable`.** Paddle has no `createSubscription` method. Subscriptions are
  created through the checkout/transaction flow, not a direct API call. Paddle still declares
  `subscriptions` for subscription management and webhook reconciliation.
  `isDirectSubscriptionCapable(paddleProvider)` returns `false`.
- **Partial refunds are not supported.** `refund` throws when `input.amount` is set (see Failure
  scenarios). `meteredBilling` is absent, the same as Stripe.
- **No `priceLookupKeys`.** Paddle does not implement `PriceLookupKeyCapable`; keyed price creation,
  lookup-key list filtering, and atomic lookup-key transfer are unavailable.

## Subscription lifecycle pause and resume

`PaddleProvider` implements `SubscriptionPauseCapable`, `PausedSubscriptionResumeCapable`, and
`ScheduledSubscriptionChangeCapable`. Payable sends every policy field explicitly instead of relying
on Paddle defaults:

| Payable policy | Paddle request |
| --- | --- |
| pause `effectiveTiming: 'immediate'` | `effective_from: 'immediately'` |
| pause `effectiveTiming: 'nextRenewal'` | `effective_from: 'next_billing_period'` |
| `resumeAt: Date` / `null` | RFC 3339 `resume_at` / `null` |
| `startNewBillingPeriod` | `on_resume: 'start_new_billing_period'` |
| `continueExistingBillingPeriod` | `on_resume: 'continue_existing_billing_period'` |
| immediate resume | `effective_from: 'immediately'` |
| scheduled resume | RFC 3339 `effective_from` |

An immediate pause maps the returned status to `paused`. A next-renewal pause remains active until
Paddle applies its `scheduled_change`. A scheduled resume remains paused until its effective date.
The mapper persists `scheduled_change.action`, `effective_at`, and `resume_at`; webhook reconciliation
updates the same normalized fields.

Removing a scheduled change is a separate explicit operation:
`cancelScheduledSubscriptionChange()` updates the subscription with `scheduled_change: null`.
Replacement workflows must cancel the existing change and then submit the new policy. Normal pause
and resume requests never clear a scheduled change implicitly.

Official Paddle subscription references:

- [Pause a subscription](https://developer.paddle.com/api-reference/subscriptions/pause-subscription/)
- [Resume a paused subscription](https://developer.paddle.com/api-reference/subscriptions/resume-subscription/)
- [Update a subscription](https://developer.paddle.com/api-reference/subscriptions/update-subscription/)
- [Pause subscription workflows](https://developer.paddle.com/build/subscriptions/pause-subscriptions/)

## Catalog lifecycle

`PaddleProvider` implements `CatalogCapable`, `CatalogReadCapable`, and
`CatalogLifecycleCapable`. Product and price list calls map the portable cursor to `after`, the limit
to `perPage`, and active state to Paddle's `active` or `archived` status filter. Price lists also map
`providerProductId` to Paddle's product filter. When the SDK collection has another page, Payable
returns the final entity id as `nextCursor`; callers pass that cursor back unchanged.

| Payable operation | Paddle call | Notes |
| --- | --- | --- |
| `products().retrieve(id)` | `products.get(id)` | A missing product maps to `PRODUCT_NOT_FOUND`. |
| `products().list(input)` | `products.list({ after, perPage, status })` | Reads the SDK collection page with `next()`. |
| `products().activate(id)` | `products.update(id, { status: 'active' })` | Restores an archived product. |
| `products().archive(id)` | `products.update(id, { status: 'archived' })` | Keeps the Paddle product record. |
| `prices().retrieve(id)` | `prices.get(id)` | A missing price maps to `PRICE_NOT_FOUND`. |
| `prices().list(input)` | `prices.list({ after, perPage, productId, status })` | Supports product and active-state filters. |
| `prices().activate(id)` | `prices.update(id, { status: 'active' })` | Restores an archived price. |
| `prices().archive(id)` | `prices.update(id, { status: 'archived' })` | Keeps the Paddle price record. |

Paddle product creation does not accept a `status` field. Payable creates an active product with
`products.create`. When `CreateProductInput.active` is `false`, it then archives the returned product
with `products.update`. An error from that second request is propagated, so the application can
reconcile the product before retrying.

Payable exposes no portable delete method for Paddle products or prices. Existing price monetary
terms are not updateable through the contract. Create a replacement price and archive the old price
when the amount, currency, billing interval, or interval count changes.

Paddle `custom_data` is metadata. It is not an equivalent lookup-key alias and does not provide an
atomic price-transfer mechanism. Do not use it as a substitute for `priceLookupKeys`.

Official Paddle references:

- [List products](https://developer.paddle.com/api-reference/products/list-products/)
- [Get a product](https://developer.paddle.com/api-reference/products/get-product/)
- [Update a product](https://developer.paddle.com/api-reference/products/update-product/)
- [List prices](https://developer.paddle.com/api-reference/prices/list-prices/)
- [Get a price](https://developer.paddle.com/api-reference/prices/get-price/)
- [Update a price](https://developer.paddle.com/api-reference/prices/update-price/)
- [API errors](https://developer.paddle.com/api-reference/about/errors/)
- [Archive entities](https://developer.paddle.com/api-reference/about/delete-entities/)
- [Custom data](https://developer.paddle.com/api-reference/about/custom-data/)
- [SDK libraries and retry guidance](https://developer.paddle.com/sdks/libraries/)

### Catalog idempotency

Paddle does not declare Payable's `catalogIdempotency` capability. Paddle's official SDK guidance
states that the API does not support client-supplied idempotency keys for arbitrary operations and
advises checking the entity with a list or get operation before retrying a create after a timeout or
network failure. See [Paddle SDK libraries](https://developer.paddle.com/sdks/libraries/).

A keyed Paddle product or price mutation therefore requires an engine idempotency store. Without
one, Payable returns `CATALOG_IDEMPOTENCY_STORAGE_REQUIRED` before calling Paddle. With a store,
Payable prevents concurrent duplicate execution and replays completed results. If the Paddle call
fails with an ambiguous outcome, retrying the same key returns
`IDEMPOTENCY_RECONCILIATION_REQUIRED` without another provider call. List or retrieve the entity,
compare it with the intended mutation, and use a new key only for a new intentional operation.

## Mappers

`paddle-mappers.ts` converts Paddle entities (typed in `paddle-types.ts`) to domain DTOs:

- `toMinorUnits` parses Paddle's string amounts. Paddle returns money as a decimal **string** in minor
  units; the mapper validates it against `^-?\d+$` and throws `PayableError` (`PROVIDER_AMOUNT_INVALID`)
  for any non-integer value. It also rejects values outside the safe-integer range
  (`Number.isSafeInteger`) with the same `PROVIDER_AMOUNT_INVALID` code. `Money.of` then rebuilds the
  value object with an upper-cased currency.
- `toSubscriptionDTO` maps Paddle status through `SUBSCRIPTION_STATUS` (`active`, `trialing`,
  `past_due`, `paused`, `canceled`), defaulting unknown values to `incomplete`. `currentPeriodEnd` comes
  from `currentBillingPeriod.endsAt`. `trialEndsAt` is derived via `readTrialEndsAt`, which reads the
  subscription's `trialEndsAt` first, then falls back to the first item carrying a trial end
  (`trialDates.endsAt` / `trial_dates.ends_at`), returning `null` when none is present.
- `toProductDTO` derives `active` from `status === 'active'`.
- `toRefundResultDTO` maps a Paddle adjustment: `status` is `succeeded` when the adjustment is
  `approved`, otherwise `pending`. Amount falls back to `0` / `USD` when totals are absent.

## Event normalization

`PaddleEventNormalizer` (`paddle-event-normalizer.ts`) maps Paddle event types to `NormalizedEventName`:

| Paddle event type | Normalized name |
| --- | --- |
| `customer.created` | `customer.created` |
| `customer.updated` | `customer.updated` |
| `subscription.created` | `subscription.created` |
| `subscription.activated` | `subscription.created` |
| `subscription.updated` | `subscription.updated` |
| `subscription.canceled` | `subscription.cancelled` |
| `subscription.resumed` | `subscription.resumed` |
| `transaction.completed` | `payment.succeeded` |
| `transaction.paid` | `payment.succeeded` |
| `transaction.payment_failed` | `payment.failed` |
| `transaction.billed` | `invoice.created` |
| `adjustment.created` | `refund.created` |

Unmapped types normalize to `null`. Note `subscription.activated` and `subscription.created` both
collapse to `subscription.created`, and the two transaction-success events both map to
`payment.succeeded`.

## Webhook verification

`PaddleWebhookVerifier` (`paddle-webhook-verifier.ts`) delegates to the SDK's `webhooks.unmarshal`:

```ts
private async unmarshal(client, payload, signature) {
  try {
    return await client.webhooks.unmarshal(payload, this.secret, signature);
  } catch (error) {
    throw new InvalidWebhookSignatureError('paddle', { cause: error });
  }
}
```

`unmarshal` receives the raw body, the configured `webhookSecret`, and the Paddle signature header. It
returns a `PaddleWebhookEvent` (`eventId`, `eventType`, `data`) or `null`. The verifier treats a thrown
error **and** a `null` result as a signature failure, throwing `InvalidWebhookSignatureError` with
`provider: 'paddle'`. `verifyWebhook` then returns a `VerifiedWebhook` built from those fields.

## Failure scenarios and recovery

| Scenario | Symptom | Recovery |
| --- | --- | --- |
| Partial refund requested | `ProviderCapabilityNotSupportedError('paddle', 'partial refund')` thrown by `refund` when `input.amount` is set | Issue a full refund (omit `amount`). Paddle adjustments are created with `type: 'full'`. |
| Invalid webhook signature | `InvalidWebhookSignatureError` (`provider: 'paddle'`) on a thrown error or a `null` unmarshal result | Verify `webhookSecret` matches the Paddle notification setting and the raw body is forwarded unmodified. |
| Non-integer amount from Paddle | `PayableError` `PROVIDER_AMOUNT_INVALID` from `toMinorUnits` | Indicates an unexpected amount format; inspect the offending entity. |
| Paddle API error | The SDK error propagates from the called method | Before retrying a create, reconcile by listing or fetching the entity to confirm whether the first attempt reached Paddle. |

Paddle receives no idempotency key from Payable. A create may have succeeded even when the process did
not receive the response, so a blind retry can duplicate the resource. Reconcile against Paddle by
listing or retrieving the entity before issuing another create.

## Configuration example

```ts
import { createPayable } from '@akira-io/payable';
import { PaddleProvider } from '@akira-io/payable';

const paddle = new PaddleProvider({
  apiKey: process.env.PADDLE_API_KEY!,
  webhookSecret: process.env.PADDLE_WEBHOOK_SECRET!,
});

const payable = createPayable({
  providers: { paddle },
  // storage, queue, events, clock ...
});

// Full refund (partial throws ProviderCapabilityNotSupportedError):
await payable.refund({ paymentId: 'txn_123' });
```

---

[Previous: Stripe](18-stripe.md) · [Index](../00-index.md) · [Next: SISP](20-sisp.md)
