# Revolut Provider

`RevolutProvider` (`src/infrastructure/providers/revolut/revolut-provider.ts`) implements the Merchant
API flow that fits Payable's current `PaymentProvider` contract: amount checkout orders, subscription
setup orders, direct subscriptions, customers, refunds, signed webhooks, and reconciliation.
Business API Treasury features and webhooks use the separate `RevolutBusinessTreasuryProvider`; see
[Revolut Business Treasury](21d-revolut-business-treasury.md).

Business API card issuing uses the independent `RevolutBusinessIssuingProvider`. It implements the
generic Issuing card and transaction contracts without adding Business operations to
`RevolutProvider` or `PaymentProvider`.

Business accounting settings and expense reads use the independent
`RevolutBusinessAccountingProvider`. They are registered as an `AccountingProvider`, not as payment,
Treasury, or tax-calculation capabilities.

## Construction and options

- `secretKey` - Merchant API secret key sent as `Authorization: Bearer <key>`.
- `webhookSecret` - Merchant webhook signing secret returned when creating or retrieving a Revolut
  webhook.
- `environment` - `production` by default; `sandbox` uses `https://sandbox-merchant.revolut.com`.
- `baseUrl` - optional override for tests or custom routing.
- `apiVersion` - defaults to `2026-04-20`, sent as `Revolut-Api-Version`.
- `webhookToleranceMs` - defaults to 5 minutes for replay protection.
- `logger` - forwarded to the Revolut event normalizer.
- `fetch` - optional injected HTTP client. Production uses Node 20's global `fetch`.

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

### Revolut Business Issuing

```ts
import { RevolutBusinessIssuingProvider } from '@akira-io/payable';

const issuing = new RevolutBusinessIssuingProvider({
  tokenProvider: {
    getAccessToken: () => accessTokenStore.current(),
  },
});
```

The provider name is `revolut-business-issuing`. It resolves a fresh Business access token for every
request and uses the same production Business API base URL as the Treasury provider. Revolut does not
make its Cards API available in Sandbox; use injected HTTP tests or an approved production test
account for card integration testing.

### Revolut Terminal

`RevolutTerminalProvider` implements the independent terminal contracts for server-driven push
payments. It uses the Merchant API directly and does not add a device SDK or peer dependency.

```ts
import { RevolutTerminalProvider } from '@akira-io/payable';

const terminal = new RevolutTerminalProvider({
  secretKey: process.env.REVOLUT_MERCHANT_SECRET_KEY!,
  environment: 'sandbox',
  locationId: process.env.REVOLUT_LOCATION_ID!,
  fulfilmentType: 'eat_in',
  posPartnerName: 'My POS',
});
```

`locationId` is required because Revolut links every POS order and terminal to one physical
location. `fulfilmentType` defaults to `eat_in`; set it to `take_away` when that is the merchant's
transaction context. `posPartnerName` defaults to `Payable` and is sent as
`metadata.pos_partner_name`.

Provider-specific details are documented in [Disputes](21a-revolut-disputes.md),
[Payouts](21b-revolut-payouts.md), and [Webhook Management](21c-revolut-webhook-management.md).

### Revolut Business Accounting

```ts
import {
  isAccountingExpenseReadCapable,
  RevolutBusinessAccountingProvider,
} from '@akira-io/payable';

const accounting = new RevolutBusinessAccountingProvider({
  tokenProvider: {
    getAccessToken: () => accessTokenStore.current(),
  },
});

if (isAccountingExpenseReadCapable(accounting)) {
  const expenses = await accounting.listAccountingExpenses({ limit: 100 });
}
```

The provider name is `revolut-business-accounting`. It obtains a fresh Business access token for each
request through `tokenProvider`, keeping OAuth, JWT, and certificate renewal outside the adapter. Configure
Business API `READ` access for list and retrieve operations and `WRITE` access for setting mutations.

It declares `categories`, `taxRates`, `labels`, and `expenseReads`:

- Categories support create, list, retrieve, update, and delete. Revolut requires `code` on creation;
  omission fails before HTTP with `PROVIDER_REQUEST_INVALID`.
- Tax rates support create, list, retrieve, rename, and delete. Revolut percentages are immutable after
  creation, matching the generic update input, which only accepts a new name.
- Labels support create, list, retrieve, rename, and delete. Creation requires
  `providerGroupId`. Because Revolut addresses labels inside groups, normalized `providerLabelId`
  values are opaque compound IDs in the form `{groupId}:{labelId}`; callers should persist and return
  them unchanged.
- Expenses support list and retrieve only. Revolut has no expense update endpoint, so the adapter
  implements `AccountingExpenseReadCapable` and intentionally does not advertise full `expenses`.

Category, tax-rate, label-group, and label lists follow Revolut cursor pagination. Expense listing
uses the API's `expense_date` boundary, supports `from`, `to`, normalized status filtering, and requests
at most 500 records per page. When an expense has different category or tax-rate IDs across its splits,
the singular normalized field is `null` instead of choosing an incorrect value.

The adapter does not fetch receipt content and does not expose receipt IDs, payer names, or other
provider-only expense details. Revolut Expenses is unavailable in Sandbox, so expense integration
tests require an approved production test account or an injected HTTP client. Accounting settings can
still be tested with the injected client.

Business accounting writes do not declare a request ID or idempotency field. The standard operation
context is accepted for contract consistency, but the adapter does not invent unsupported headers or
body fields. Ledger access, expense updates, and `TaxProvider` calculation capabilities are not
advertised.

## Declared capabilities

`capabilities()` returns `checkout`, `refunds`, `webhooks`, `customers`, `paymentMethods`,
`paymentMethodSetup`, `disputes`, `payouts`, `webhookEndpointManagement`, and `subscriptions`. The
provider implements the corresponding optional contracts and intentionally does not declare
`catalog`, `charges`, `billingPortal`, or `invoicePdf`.

## Customers

`createCustomer(input, ctx)` calls `POST /api/customers` with `email` and optional `full_name`;
`updateCustomer(input, ctx)` calls `PATCH /api/customers/{customer_id}`. Both responses map `id`,
`email`, and `full_name` to `CustomerDTO`. Payable customer `metadata` is not sent because the
Merchant schema does not support it. These endpoints do not declare `Idempotency-Key`, so the provider
does not forward `ctx.idempotencyKey`.

## Saved payment methods

`listPaymentMethods({ providerCustomerId, limit })` calls
`GET /api/customers/{customer_id}/payment-methods` and maps card, Revolut Pay, and SEPA Direct Debit
methods to generic display fields. Non-card fields that do not apply are `null`.

`deletePaymentMethod({ providerCustomerId, providerPaymentMethodId }, ctx)` calls the customer-scoped
`DELETE` endpoint. The Merchant API does not declare `Idempotency-Key` for this operation, so the
provider does not invent one.

## Payment method setup

`RevolutProvider` implements `PaymentMethodSetupCapable` with a zero-amount Merchant order linked to
the customer. Currency is required, and the adapter forwards the return URL, opaque reference, and
operation idempotency key. The order token maps to `clientSecret`, while the hosted payment link maps
to `checkoutUrl`.

This setup flow is for future merchant-initiated payments, so only `off_session` usage is supported.
An `on_session` request fails before the HTTP call with `PROVIDER_OPERATION_UNSUPPORTED`. Order states
map to the normalized setup lifecycle. After Revolut completes the order, the adapter exposes the
saved `payment_method.id` from its last completed payment.

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
  "customer": { "id": "revolut_customer_id" },
  "merchant_order_data": { "reference": "order-42" },
  "redirect_url": "https://shop.example/success"
}
```

`providerCustomerId` is sent as `customer.id`; `reference` is sent as
`merchant_order_data.reference`. `lineItems` and Payable catalog price ids are not sent because the
endpoint is amount-based. A payment checkout without `amount` throws `CHECKOUT_AMOUNT_REQUIRED`. The
`POST /api/orders` spec does not declare `Idempotency-Key`, so the provider does not invent it.

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
    reference: 'sub-42',
  });

// session.id  -> Revolut setup order id
// session.url -> Revolut Hosted Payment Page URL
```

The provider calls `POST /api/subscriptions` with `plan_variation_id`, `customer_id`,
`external_reference`, `setup_order_redirect_url`, and optional `trial_duration`, then retrieves the
setup order `checkout_url`.

This path supports one plan variation with quantity `1`. Multi-item subscriptions, quantity changes,
and coupons throw `ProviderCapabilityNotSupportedError` because Revolut keeps those details in the
plan variation.

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

Revolut refunds use `POST /api/orders/{order_id}/refund` and require amount/currency:

```ts
await payable
  .customer(billable, 'revolut')
  .refund('6516e61c-d279-a454-a837-bc52ce55ed49', Money.of(100, 'GBP'), {
    reason: 'Returned item',
    reference: 'refund-42',
  });
```

The provider forwards `ctx.idempotencyKey` as `Idempotency-Key` and `reference` as
`merchant_order_data.reference`; both are declared by the Merchant API refund endpoint.

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
| `ORDER_AUTHORISED` | `processing` |
| `ORDER_COMPLETED` | `succeeded` |
| `ORDER_FAILED` | `failed` |
| `ORDER_PAYMENT_AUTHENTICATED` | `processing` |
| `ORDER_PAYMENT_AUTHENTICATION_CHALLENGED` | `pending` |
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

`currentPeriodEnd` and `trialEndsAt` are `null` for webhook-only reconciliation because the payload
does not contain the full subscription object.

## Business card issuing

`RevolutBusinessIssuingProvider` declares only `cards` and `transactions`. Revolut Business does not
provide equivalent generic cardholder creation or authorization-response operations, so those
capabilities are not advertised.

Card creation supports virtual cards only. `ctx.idempotencyKey` is forwarded as Revolut
`request_id`; `holderReference` maps to `holder_id`, the label is forwarded, and a generic
`spendingLimit` maps to Revolut's single-transaction limit in major currency units. Physical card
creation fails before an HTTP request because Revolut requires physical cards to be created in its
Business application.

Card state operations map as follows:

| Generic state | Revolut operation or state |
| --- | --- |
| `active` from `frozen` | `POST /cards/{id}/unfreeze` |
| `active` from `locked` | `POST /cards/{id}/unlock` |
| `inactive` | `POST /cards/{id}/freeze` |
| `blocked` | `POST /cards/{id}/lock` |
| `canceled` | `DELETE /cards/{id}` |

Card lists paginate with `created_before` and a maximum page size of 100. Returned DTOs contain only
the card ID, holder ID, virtual or physical form, normalized state, product scheme, last four digits,
expiry, and creation time. The provider never calls `/cards/{id}/sensitive-details`, never requests
the `READ_SENSITIVE_CARD_DATA` scope, and never returns PAN, CVV, or PIN.

Issuing transaction reads reuse Business `GET /transactions` and `GET /transaction/{id}`. Results
are restricted to records containing a card ID, can be filtered by `providerCardId`, and map card
payments, refunds, and reverted transactions to `capture`, `refund`, and `reversal` respectively.
The Business API has no issuing authorization identifier, so that optional generic filter is rejected.

## Terminal push payments

`RevolutTerminalProvider` declares `devices` and `payments`. Device discovery calls
`GET /api/terminals?operation_mode=pos&location_id={locationId}`. Because the response does not
include a location identifier, the normalized device receives the location used for the query.
`retrieveTerminalDevice` searches that filtered result; the Merchant API does not expose a separate
terminal retrieval endpoint.

Payment creation follows Revolut's required sequence:

1. Confirm that the selected terminal is online at the configured location.
2. Create a Merchant order with `channel: pos`, `capture_mode: manual`, the configured location and
   fulfilment context, and the exact amount and currency.
3. Create the payment intent for that order and terminal with the same minor-unit amount.

The `manual` order field is controlled by Revolut's push-payment protocol. It does not provide the
caller with delayed-capture control: `captureMethod: 'manual'` is therefore rejected before HTTP with
`PROVIDER_OPERATION_UNSUPPORTED`. The terminal automatically captures or cancels the payment.

Intent polling maps `pending`, `processing`, `failed`, and `cancelled` to the generic lifecycle. A
Revolut intent in `completed` state is still `in_progress` because completion only means the terminal
interaction ended. When the intent contains `payment_id`, the adapter reads `/api/payments/{id}` and
only maps `captured` or `completed` to `succeeded`; transitional states remain `in_progress`, while
`declined`, `failed`, and `cancelled` remain unsuccessful final states.

The current order, payment-intent, and cancel endpoint schemas do not declare `Idempotency-Key` or a
request-ID header. The adapter accepts the standard operation context but does not send unsupported
headers. Cancellation is available only while the intent remains pending, as enforced by Revolut.

Sandbox uses `https://sandbox-merchant.revolut.com`; its virtual terminal ID is
`11111111-0000-0000-0000-000000000000`. Keep Merchant keys server-side and encrypted. Provider
serialization and inspection expose only `{ name: 'revolut-terminal' }`.

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

This provider phase follows Revolut Merchant API `2026-04-20` from
`revolut-engineering/revolut-openapi`, production `https://merchant.revolut.com`, sandbox
`https://sandbox-merchant.revolut.com`, customer/subscription endpoints, and HMAC SHA-256 webhooks.

---

[Previous: SISP](20-sisp.md) · [Index](../00-index.md) · [Next: Storage (Knex)](../persistence/21-storage-knex.md)
