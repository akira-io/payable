# Stripe Provider

`StripeProvider` (`src/infrastructure/providers/stripe/stripe-provider.ts`) is the reference
implementation of `PaymentProvider`. It implements the base contract plus all three optional
interfaces: `ChargeCapable`, `DirectSubscriptionCapable`, `InvoiceCapable`, and
`PaymentWebhookCapable`. Its registry `name` is `'stripe'`.

## Construction and options

```ts
export interface StripeProviderOptions {
  secretKey: string;
  webhookSecret: string;
  logger?: Logger;
}

new StripeProvider(options: StripeProviderOptions, client?: Stripe);
```

- `secretKey` - the Stripe API key used to lazily construct the SDK client.
- `webhookSecret` - the signing secret passed to `StripeWebhookVerifier`.
- `logger` (optional) - a `Logger` forwarded to `StripeEventNormalizer`.
- `client` (optional) - an injected `Stripe` instance, used in tests. When omitted, the client is
  created on first use via a dynamic `import('stripe')`, so the `stripe` package is only loaded when the
  provider is actually exercised (zero-peer-dependency guarantee).

```ts
const stripe = new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});

const payable = createPayable({ providers: { stripe }, /* storage, queue, ... */ });
```

## Declared capabilities

```ts
capabilities(): ProviderCapabilities {
  return new Set([
    'checkout',
    'charges',
    'subscriptions',
    'trials',
    'refunds',
    'coupons',
    'billingPortal',
    'invoicePdf',
    'webhooks',
    'customers',
    'catalog',
  ]);
}
```

Stripe supports every current Payable provider capability except `meteredBilling` (absent from the
set). It is the only built-in provider that implements `ChargeCapable`, `DirectSubscriptionCapable`,
`InvoiceCapable` (`listInvoices`, `downloadInvoicePdf`), and `PaymentWebhookCapable`.

## Checkout handling

`createCheckoutSession` calls `checkout.sessions.create`. Payable checkout `reference` is forwarded
as Stripe `client_reference_id`; idempotency still uses Stripe's request option.
Refund `reference` is forwarded as Stripe refund `metadata.reference`.

## Subscription handling

Subscription operations are delegated to `StripeSubscriptions`
(`src/infrastructure/providers/stripe/stripe-subscriptions.ts`), constructed with a lazy client getter
so it shares the provider's single SDK instance.

| Operation | Stripe call | Behavior |
| --- | --- | --- |
| `create` | `subscriptions.create` | Uses `input.items` when present, otherwise a single item from `priceId` with `quantity ?? 1`. Applies `trial_period_days` and `discounts` (coupon) when provided. |
| `update` | `subscriptions.retrieve` then `subscriptions.update` | When `priceId` or `quantity` change, it retrieves the subscription to find the first item id and swaps it. |
| `cancel` | `subscriptions.cancel` or `subscriptions.update` | `immediately: true` cancels now; otherwise sets `cancel_at_period_end: true`. |
| `resume` | `subscriptions.update` | Clears the pending cancellation with `cancel_at_period_end: false`. |

`createSubscription` (from `DirectSubscriptionCapable`) routes to `StripeSubscriptions.create`; the
contract's `updateSubscription`, `cancelSubscription`, and `resumeSubscription` route to the matching
methods. Every call forwards `ctx.idempotencyKey` to Stripe's `idempotencyKey` request option.

## Entity mapping

`stripe-mappers.ts` converts Stripe SDK objects into domain DTOs. Key behaviors:

- Money is always reconstructed via `Money.of(amount, currency.toUpperCase())`. Stripe currencies are
  lower-cased on the wire; the engine normalizes to upper-case currency codes.
- `stripeAmount` / `stripeMoney` (`stripe-amounts.ts`) rescale between the engine's currency precision
  and Stripe's per-currency exponent (zero-decimal currencies like `JPY`, three-decimal like `KWD`).
  When a downscale would drop significant digits, the rescale throws `PayableError`
  (`PROVIDER_CURRENCY_EXPONENT_MISMATCH`) rather than silently losing precision.
- `toPriceDTO` resolves the unit amount from `unit_amount`, falling back to an integer
  `unit_amount_decimal`. A non-integer decimal throws `PayableError`
  (`PROVIDER_PRICE_AMOUNT_UNRESOLVABLE`).
- `toSubscriptionDTO` maps the Stripe status through `isSubscriptionStatus`, defaulting unknown values
  to `incomplete`. `currentPeriodEnd` is read from the first item's `current_period_end` (falling back
  to the subscription-level field) and converted from Unix seconds. `trialEndsAt` comes from
  `trial_end`.
- `PAYMENT_STATUS` exhaustively covers the Stripe SDK's `PaymentIntent.Status` union and translates it
  into the domain `PaymentStatus`. `REFUND_STATUS` translates known refund states into
  `RefundStatus`. Runtime-unmapped states default to `pending`.

## Event normalization

`StripeEventNormalizer` (`stripe-event-normalizer.ts`) maps raw Stripe event types to the engine's
`NormalizedEventName`. The full map:

| Stripe event type | Normalized name |
| --- | --- |
| `checkout.session.completed` | `checkout.completed` |
| `checkout.session.async_payment_succeeded` | `checkout.completed` |
| `checkout.session.async_payment_failed` | `payment.failed` |
| `charge.succeeded` | `payment.succeeded` |
| `charge.failed` | `payment.failed` |
| `payment_intent.succeeded` | `payment.succeeded` |
| `payment_intent.payment_failed` | `payment.failed` |
| `customer.created` | `customer.created` |
| `customer.updated` | `customer.updated` |
| `customer.subscription.created` | `subscription.created` |
| `customer.subscription.updated` | `subscription.updated` |
| `customer.subscription.deleted` | `subscription.cancelled` |
| `customer.subscription.resumed` | `subscription.resumed` |
| `invoice.created` | `invoice.created` |
| `invoice.paid` | `invoice.paid` |
| `invoice.payment_succeeded` | `invoice.paid` |
| `invoice.payment_failed` | `invoice.payment_failed` |
| `charge.refunded` | `refund.succeeded` |
| `refund.created` | `refund.created` |
| `refund.failed` | `refund.failed` |

Unmapped types normalize to `null`. The provider keeps the raw `type` alongside `normalizedType`, so an
unrecognized event is still persisted, just not reconciled.

Disputes, payouts, setup intents, payment methods, Connect, Treasury, Terminal, Issuing, Identity, and
Financial Connections events remain intentionally unmapped until Payable has an approved generic
optional capability for that domain.

## Payment webhook reconciliation

`StripeProvider` implements `PaymentWebhookCapable` so the generic webhook pipeline can reconcile local
payment rows after signature verification. `reconcilePayment(verified)` is synchronous and pure. It
returns `null` for non-payment events or malformed payment payloads.

Supported payment reconciliation sources:

| Stripe event type | Local payment id | Domain status |
| --- | --- | --- |
| `payment_intent.succeeded` | `PaymentIntent.id` | `succeeded` |
| `payment_intent.payment_failed` | `PaymentIntent.id` | `failed` |
| `payment_intent.canceled` | `PaymentIntent.id` | `canceled` |
| `charge.succeeded` | `Charge.payment_intent` | `succeeded` |
| `charge.failed` | `Charge.payment_intent` | `failed` |
| `checkout.session.completed` with `payment_status: 'paid'` | `Checkout.Session.id` | `succeeded` |
| `checkout.session.async_payment_succeeded` | `Checkout.Session.id` | `succeeded` |
| `checkout.session.async_payment_failed` | `Checkout.Session.id` | `failed` |

The checkout-session id is used because Payable records redirect-checkout pending payments under the
session id before the browser leaves the application. The pipeline still gates the update through
`PaymentStateMachine`, so stale Stripe events cannot move a final local payment into an invalid state.

## Webhook verification

`StripeWebhookVerifier` (`stripe-webhook-verifier.ts`) wraps the SDK's async signature check:

```ts
async verify(stripe: Stripe, payload: string, signature: string): Promise<Stripe.Event> {
  try {
    return await stripe.webhooks.constructEventAsync(payload, signature, this.secret);
  } catch (error) {
    throw new InvalidWebhookSignatureError('stripe', { cause: error });
  }
}
```

The raw request body (string `payload`) and the `Stripe-Signature` header value are passed to
`constructEventAsync` with the configured `webhookSecret`. The signature must be computed over the exact
raw bytes, so the adapter must hand over the unparsed body. On any failure the verifier throws
`InvalidWebhookSignatureError` with `provider: 'stripe'` and the original error as `cause`.

`verifyWebhook` then returns a `VerifiedWebhook` with `providerEventId` (`event.id`), the raw `type`,
the `normalizedType`, and `event.data.object` as `data`.

## Failure scenarios and recovery

| Scenario | Symptom | Recovery |
| --- | --- | --- |
| Invalid webhook signature | `InvalidWebhookSignatureError` (`provider: 'stripe'`) from `verifyWebhook` | Confirm `webhookSecret` matches the Stripe endpoint's secret and that the adapter forwards the raw, unmodified body. Stripe retries the delivery. |
| Stripe API error | The underlying SDK error propagates from the called method | Calls are idempotent via `ctx.idempotencyKey`; safe to retry the same operation with the same key. |
| Price has no integer amount | `PayableError` `PROVIDER_PRICE_AMOUNT_UNRESOLVABLE` from `toPriceDTO` | Use integer minor-unit prices; non-integer `unit_amount_decimal` is rejected. |
| Currency exponent mismatch | `PayableError` `PROVIDER_CURRENCY_EXPONENT_MISMATCH` from `stripeAmount` / `stripeMoney` | The amount cannot be rescaled to Stripe's currency exponent without precision loss; use an amount that fits the currency's minor-unit granularity. |
| Invoice has no PDF | `PayableError` `INVOICE_PDF_UNAVAILABLE` from `downloadInvoicePdf` | Wait until Stripe finalizes the invoice; draft invoices have no `invoice_pdf`. |
| Invoice PDF URL not https | `PayableError` `INVOICE_PDF_UNTRUSTED_URL` from `downloadInvoicePdf` | Stripe returned a non-`https://` `invoice_pdf`; the download is refused. |
| Invoice PDF download fails | `PayableError` `INVOICE_PDF_DOWNLOAD_FAILED` with `{ status }` | Transient; retry the download. The status code is in the error context. |
| Invoice PDF too large | `PayableError` `INVOICE_PDF_TOO_LARGE` with `{ bytes }` | The PDF exceeds the 10 MB cap (checked against `content-length` and the streamed body). |

## Configuration example

```ts
import { createPayable } from '@akira-io/payable';
import { StripeProvider } from '@akira-io/payable';

const stripe = new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
});

const payable = createPayable({
  providers: { stripe },
  // storage, queue, events, clock ...
});

// Charge a customer (ChargeCapable):
await payable
  .customer({ billableType: 'User', billableId: '1', email: 'jane@example.com' })
  .charge(Money.of(1500, 'USD'));
```

---

[Previous: Providers](17-providers.md) · [Index](../00-index.md) · [Next: Paddle](19-paddle.md)
