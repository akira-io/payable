# Stripe Provider

Stripe Treasury, including its independent webhook verifier, is implemented by the separate
`StripeTreasuryProvider`; see [Stripe Treasury](18a-stripe-treasury.md).

Stripe Tax is also exposed independently through `StripeTaxProvider`. It implements the generic tax
calculation and transaction contracts without adding Stripe-specific methods to `PaymentProvider`.

Stripe Issuing is exposed through `StripeIssuingProvider`, with a separate registry and no card data
or operations added to the payment provider.

Stripe Identity is exposed through `StripeIdentityProvider`. Verification sessions remain separate
from payment customers and Connect onboarding, and normalized results exclude verified personal data.

`StripeProvider` (`src/infrastructure/providers/stripe/stripe-provider.ts`) is the reference
implementation of `PaymentProvider`. It implements the base contract and optional capabilities for
charges, subscriptions, invoices, saved payment methods, payment-method setup, disputes, payouts,
webhooks, and catalog operations. Its registry `name` is `'stripe'`.

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

### Stripe Tax provider

```ts
import { StripeTaxProvider } from '@akira-io/payable';

const tax = new StripeTaxProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
});
```

`StripeTaxProvider` has the registry name `stripe-tax` and declares the `calculations` and
`transactions` tax capabilities. Like the payment and Treasury providers, it loads the optional
Stripe SDK dynamically when no client is injected.

### Stripe Issuing provider

```ts
import { StripeIssuingProvider } from '@akira-io/payable';

const issuing = new StripeIssuingProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
});
```

`StripeIssuingProvider` has the registry name `stripe-issuing` and declares `cardholders`, `cards`,
`authorizations`, and `transactions`. It uses the same dynamic optional Stripe SDK boundary.

### Stripe Identity provider

```ts
import { StripeIdentityProvider } from '@akira-io/payable';

const identity = new StripeIdentityProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
});
```

`StripeIdentityProvider` has the registry name `stripe-identity` and declares only
`verificationSessions`. It lazily loads the optional Stripe SDK and does not add identity methods or
results to `StripeProvider`.

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
      'paymentMethods',
      'paymentMethodSetup',
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

Disputes, payouts, setup intents, payment-method lifecycle, Connect, Treasury, Terminal, Issuing,
Identity, and Financial Connections events remain intentionally unmapped because no approved generic
webhook reconciliation flow consumes them.

## Saved payment methods

`StripeProvider` implements `PaymentMethodCapable` for customer-scoped saved methods. Use
`listPaymentMethods({ providerCustomerId, limit })` to retrieve normalized display fields, or
`deletePaymentMethod({ providerCustomerId, providerPaymentMethodId }, ctx)` to detach one. Deletion
first retrieves the method through the customer-scoped Stripe endpoint, then forwards
`ctx.idempotencyKey` to `paymentMethods.detach`.

Only generic display data is returned: provider id, type, card brand, last four digits, and expiry.
Fields that do not apply to a payment method type are `null`. Collection and attachment use the
separate payment-method setup capability.

## Payment method setup

`StripeProvider` implements `PaymentMethodSetupCapable` through Setup Intents. Creation forwards the
customer, usage, optional payment method types, return URL, opaque reference metadata, and operation
idempotency key. The normalized currency field is accepted but not sent because Stripe Setup Intents
do not take a currency.

Retrieve and cancel return the same normalized setup DTO. Stripe states that require further input or
confirmation map to `requires_action`; processing, succeeded, and canceled states map directly. The
result exposes only the client secret and resulting payment method ID needed by the setup lifecycle.

## Disputes

`StripeProvider` implements `DisputeCapable` with `listDisputes`, `retrieveDispute`, and
`acceptDispute`. Accepting maps to Stripe `disputes.close` and forwards `ctx.idempotencyKey`; it is
irreversible and acknowledges the dispute as lost.

Disputes expose normalized status, amount, reason, creation time, response deadline, and the related
PaymentIntent id, falling back to the Charge id. Evidence submission is not generalized because its
shape and upload lifecycle differ across providers.

## Payouts

`StripeProvider` implements `PayoutCapable` with `listPayouts` and `retrievePayout`. List operations
use Stripe auto-pagination with a default page size and result limit of 100; a larger requested limit
continues across pages without requesting more than Stripe's per-page maximum.

Payouts map provider id, normalized lifecycle status, amount, creation time, and expected arrival
time. Creating, canceling, and reversing payouts remain outside the read-only generic capability.

## Tax calculations and transactions

`StripeTaxProvider` creates and retrieves Stripe Tax calculations. It maps multiple line items,
shipping cost, customer and shipping addresses, tax behavior, product tax codes, and customer tax
IDs into the generic tax contracts. Customer tax IDs use the portable `type:value` form, for example
`eu_vat:DE123456789`, because Stripe requires both values.

All line items and shipping in one calculation must use the same currency. A mixed-currency request
is rejected before the SDK call with `PROVIDER_TAX_CURRENCY_MISMATCH`. Successful Stripe Tax
calculation responses map to `complete`; Stripe returns an API error instead of an asynchronous
calculation object when calculation cannot complete.

`commitTaxTransaction` creates a Stripe Tax transaction from a completed calculation and forwards
the operation idempotency key. `reverseTaxTransaction` currently performs a full transaction
reversal. Partial reversals remain outside the generic contract.

## Issuing

`StripeIssuingProvider` creates and retrieves cardholders, creates virtual and physical cards,
updates card status, and provides bounded reads for cards, authorizations, and transactions. Stripe
requires a billing address for cardholders and a currency for cards. Physical cards also require a
generic shipping contact. Missing required fields are rejected before the SDK call.

A `spendingLimit` maps to a per-authorization Stripe spending limit. `active`, `inactive`, and
`canceled` card states are supported; the generic `blocked` state is rejected because Stripe does not
provide an equivalent card state. Card mappers return only brand, last four, expiry, status, form,
provider identifiers, and creation time. PAN, CVC, PIN, shipping details, and expanded provider
objects are never returned.

Authorization reads normalize Stripe lifecycle and decision state. `respondIssuingAuthorization`
uses Stripe's approve and decline REST methods and forwards idempotency. Stripe marks those methods
deprecated in favor of responding directly to real-time authorization webhooks, so new applications
should treat this method as a compatibility path until a generic synchronous webhook-response
contract is approved.

## Connect marketplace

`StripeMarketplaceProvider` is an independent marketplace provider named `stripe-connect`. It
implements seller accounts, hosted onboarding, platform-to-seller transfers, and connected-account
payouts without adding Stripe Connect fields to payment DTOs or coupling marketplace operations to
`StripeProvider`.

```ts
import { StripeMarketplaceProvider } from '@akira-io/payable';

const marketplace = new StripeMarketplaceProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
});
```

Connected accounts use Stripe's current `controller` configuration instead of the deprecated account
`type` parameter. The provider creates accounts with Stripe-managed requirement collection, Express
Dashboard access, application-paid Stripe fees, and application liability for payment losses.
`individual` and `business` map to Stripe's `individual` and `company` business types; the generic
contract does not expose Stripe account-type vocabulary.

Account status is derived from `charges_enabled`, `payouts_enabled`, submitted details, and
`requirements.currently_due`. Disabled accounts map from `requirements.disabled_reason`. Account
listing uses bounded auto-pagination and applies the generic status filter after normalization.

Onboarding links use `account_onboarding` and forward `ctx.idempotencyKey`. Transfers move funds from
the platform balance to the destination connected account and also forward idempotency. Stripe does
not expose a transfer lifecycle status, so unreversed transfers normalize to `completed` and fully
reversed transfers normalize to `reversed`.

Payout create, list, and retrieve requests pass the seller account ID only through Stripe's
`stripeAccount` request option. This makes payouts operate on the connected account balance while
account, onboarding, and transfer calls remain platform requests. `pending` and `in_transit` Stripe
payouts normalize to `pending`; `paid`, `failed`, and `canceled` retain their meaning.

Marketplace transfers do not create customer payments and are not automatically reversed when an
unrelated payment fails. The application remains responsible for choosing the payment flow, waiting
for asynchronous funds when required, and reconciling transfer reversals.

## Terminal

`StripeTerminalProvider` is an independent server-driven Terminal provider. It lists and retrieves
registered Readers and processes card-present PaymentIntents without introducing browser, mobile,
Bluetooth, or hardware SDK dependencies.

```ts
import { StripeTerminalProvider } from '@akira-io/payable';

const terminal = new StripeTerminalProvider({
  secretKey: process.env.STRIPE_SECRET_KEY!,
});
```

Device listing supports Stripe location filters and bounded auto-pagination. A Reader with an active
action maps to `busy`; otherwise Stripe's `online` and `offline` states retain their meaning. Device
DTOs include the Reader ID, label, location ID, serial number, and device type. IP addresses,
networking details, metadata, and device secrets are not returned.

`createTerminalPayment` creates a PaymentIntent with `payment_method_types: ['card_present']`, then
hands it to the selected Reader through `terminal.readers.processPaymentIntent`. Automatic capture
is the supported mode. `captureMethod: 'manual'` is rejected before creating Stripe resources because
the current generic Terminal contract has no capture operation. PaymentIntents encountered in
`requires_capture` normalize to `pending`, never `succeeded`. Both write calls receive distinct
deterministic keys derived from `ctx.idempotencyKey`. Long Payable keys are hashed so every forwarded
key remains within Stripe's 255-character limit. When Payable does not provide a key, the adapter
omits Stripe idempotency options instead of deriving a shared fallback.

Stripe Reader actions do not have independent identifiers. The provider therefore returns an opaque,
versioned `providerTerminalPaymentId` that identifies both the Reader and PaymentIntent.
`providerPaymentId` contains the PaymentIntent ID. Retrieval loads that exact PaymentIntent and only
uses Reader action state when the action belongs to the same payment. The provider records the Reader
ID in PaymentIntent metadata and rejects identifiers whose Reader and PaymentIntent do not match.
Legacy Reader-only identifiers cannot identify a payment safely and are rejected. Persist the
versioned identifier returned by `createTerminalPayment` after upgrading.

`cancelTerminalPayment` returns `PROVIDER_OPERATION_UNSUPPORTED` before calling Stripe. Stripe's
server-driven `cancel_action` endpoint targets the Reader's current action, not a specific
PaymentIntent, so it cannot safely fulfill a payment-specific cancellation contract when actions
change concurrently. If handoff fails after PaymentIntent creation, retrying with the same
idempotency key reuses the same Stripe write results.

## Identity verification

`createIdentityVerification` creates a Stripe Identity VerificationSession and forwards the opaque
application reference as both `client_reference_id` and `metadata.reference`. The reference must not
contain a name, email address, phone number, national identifier, or other PII. `returnUrl` maps to
Stripe's `return_url`, and every create, cancel, and redact request forwards `ctx.idempotencyKey`.

Supported check combinations are:

| Generic checks | Stripe configuration |
| --- | --- |
| `document` | `type: document` |
| `document`, `selfie` | document with `require_matching_selfie` |
| `document`, `id_number` | document with `require_id_number` |
| `document`, `selfie`, `id_number` | document with both options |
| `id_number` | `type: id_number` |

`selfie` without `document`, empty check lists, `address`, and `phone` fail before an SDK request with
`PROVIDER_OPERATION_UNSUPPORTED`. Stripe exposes address and phone checks through restricted flows,
not through the generic session configuration implemented here.

Stripe `requires_input`, `processing`, `verified`, and `canceled` states map directly to the generic
lifecycle. Redaction `processing` and `validated` remain `processing`; only Stripe redaction state
`redacted` maps to `redacted`. Stripe does not expose a verification-completion timestamp on the
session, so `verifiedAt` is `null`.

The returned DTO contains only the session ID, opaque reference, requested checks, normalized status,
short-lived client secret and verification URL, and creation time. It never returns or expands
`verified_outputs`, `last_verification_report`, `last_error`, `provided_details`, document images,
selfies, biometric data, national identifiers, or VerificationReports. Applications must not log or
persist the client secret or verification URL and remain responsible for consent, retention, access
control, and regulatory compliance.

Cancellation is irreversible and Stripe permits it only while a session requires input. Redaction is
also irreversible, can take several days, erases metadata, and eventually emits Stripe's redacted
event. Poll `retrieveIdentityVerification` until the normalized status is `redacted` when completion
matters to the application.

## Provider webhook management

`StripeProvider` implements remote webhook endpoint create, list, retrieve, update, and delete through
`ProviderWebhookEndpointManagementCapable`. Write operations forward `ctx.idempotencyKey`; list uses
bounded auto-pagination.

Stripe returns a signing secret only when an endpoint is created, so `signingSecret` is normally
`null` on list, retrieve, and update responses. Signing-secret rotation is not exposed because Stripe
does not provide an equivalent operation.

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
| `payment_intent.processing` | `PaymentIntent.id` | `processing` |
| `payment_intent.amount_capturable_updated` | `PaymentIntent.id` | `processing` |
| `charge.succeeded` | `Charge.payment_intent` | `succeeded` |
| `charge.failed` | `Charge.payment_intent` | `failed` |
| `charge.pending` | `Charge.payment_intent` | `processing` |
| `checkout.session.completed` with `payment_status: 'paid'` | `Checkout.Session.id` | `succeeded` |
| `checkout.session.async_payment_succeeded` | `Checkout.Session.id` | `succeeded` |
| `checkout.session.async_payment_failed` | `Checkout.Session.id` | `failed` |
| `checkout.session.expired` | `Checkout.Session.id` | `canceled` |

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
  .charge({ amount: Money.of(1500, 'USD'), reference: 'order-1' });
```

---

[Previous: Providers](17-providers.md) · [Index](../00-index.md) · [Next: Paddle](19-paddle.md)
