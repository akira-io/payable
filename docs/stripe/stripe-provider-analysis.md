# Stripe Provider Analysis

This document analyzes the current `StripeProvider` and its fit against Stripe's current GA OpenAPI
surface. It is analysis only. It does not approve implementation beyond the roadmap below.

Sources inspected on 2026-07-07:

- Stripe OpenAPI repository: https://github.com/stripe/openapi
- Stripe GA OpenAPI spec: https://raw.githubusercontent.com/stripe/openapi/master/latest/openapi.spec3.json
- Local provider: `src/infrastructure/providers/stripe/stripe-provider.ts`
- Local mappers: `src/infrastructure/providers/stripe/stripe-mappers.ts`
- Local webhook normalizer: `src/infrastructure/providers/stripe/stripe-event-normalizer.ts`
- Stripe docs page in this repo: `docs/integrations/18-stripe.md`

## Current State

`StripeProvider` is the most complete built-in Payable provider. It keeps the Stripe SDK behind the
infrastructure provider layer, uses a dynamic `import('stripe')`, and pins the SDK client to
`STRIPE_API_VERSION = '2026-06-24.dahlia'`.

The provider implements:

| Surface | Current implementation |
| --- | --- |
| Core `PaymentProvider` | `name`, `capabilities()`, `createCheckoutSession`, `refund`. |
| `CustomerCapable` | `createCustomer`, `updateCustomer`. The class is structurally capable even though the `implements` clause lists only some optional interfaces. |
| `CatalogCapable` | `createProduct`, `updateProduct`, `createPrice`. |
| `DirectSubscriptionCapable` | `createSubscription` through `StripeSubscriptions`. |
| `SubscriptionManagementCapable` | `updateSubscription`, `cancelSubscription`, `resumeSubscription` through `StripeSubscriptions`. |
| `ChargeCapable` | `charge`, backed by Stripe Payment Intents. |
| `BillingPortalCapable` | `billingPortal`, backed by billing portal sessions. |
| `InvoiceCapable` | `listInvoices`, `downloadInvoicePdf`. |
| `WebhookCapable` | `verifyWebhook`, `reconcileSubscription`. |

Declared capabilities:

| Capability | Declared |
| --- | --- |
| `checkout` | yes |
| `charges` | yes |
| `subscriptions` | yes |
| `trials` | yes |
| `refunds` | yes |
| `coupons` | yes |
| `billingPortal` | yes |
| `meteredBilling` | no |
| `invoicePdf` | yes |
| `webhooks` | yes |
| `customers` | yes |
| `catalog` | yes |

## DTOs and Mappers

Stripe mapping is centralized in `stripe-mappers.ts`.

| Mapper | Domain DTO | Notes |
| --- | --- | --- |
| `toCustomerDTO` | `CustomerDTO` | Maps id, email, and name. |
| `toProductDTO` | `ProductDTO` | Maps id, name, and active. |
| `toPriceDTO` | `PriceDTO` | Resolves integer `unit_amount` or integer `unit_amount_decimal`; rejects fractional minor-unit amounts. |
| `toCheckoutSessionDTO` | `CheckoutSessionDTO` | Requires a provider redirect URL. |
| `toSubscriptionDTO` | `SubscriptionDTO` | Maps subscription status, trial end, and current period end. |
| `toSubscriptionDTOFromWebhook` | `SubscriptionDTO` | Maps webhook payloads after subscription payload validation. |
| `toChargeResultDTO` | `ChargeResultDTO` | Maps Payment Intent status into Payable `PaymentStatus`. |
| `toRefundResultDTO` | `RefundResultDTO` | Maps Refund status into Payable `RefundStatus`. |
| `toInvoiceDTO` | `InvoiceDTO` | Maps status, total, hosted URL, and PDF URL. |

Money conversion uses `stripeAmount` and `stripeMoney`, preserving currency exponent correctness and
throwing `PayableError` instead of silently losing precision.

## Webhook Normalizer

`StripeEventNormalizer` maps these Stripe events into existing Payable domain event names:

| Stripe event | Payable normalized type |
| --- | --- |
| `checkout.session.completed` | `checkout.completed` |
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
| `invoice.payment_failed` | `invoice.payment_failed` |
| `charge.refunded` | `refund.succeeded` |
| `refund.created` | `refund.created` |
| `refund.failed` | `refund.failed` |

Unknown Stripe events normalize to `null` and are logged. This is the right default: Payable can store
the provider event without pretending it knows how to reconcile it.

## Idempotency Forwarding

The provider forwards `ctx.idempotencyKey` to mutating Stripe SDK calls for customers, products,
prices, checkout sessions, subscriptions, charges, refunds, and billing portal sessions. This matches
Payable's existing idempotency model and keeps retry semantics outside the core provider contract.

## Current Test Coverage

Relevant tests include:

| Test file | Coverage area |
| --- | --- |
| `tests/stripe-provider.test.ts` | Provider construction, capabilities, SDK calls, idempotency, dynamic import boundary. |
| `tests/stripe-amounts.test.ts` | Currency exponent conversion and precision safety. |
| `tests/stripe-webhook-verifier.test.ts` | Signature verification behavior. |
| `tests/provider-mappers.test.ts` | Mapper behavior and status mapping. |
| `tests/subscriptions.test.ts` | Stripe subscription behavior and direct subscription integration. |
| `tests/payments.test.ts` | Charge/payment flows. |
| `tests/webhooks.test.ts`, `tests/webhook-replay.test.ts`, `tests/webhook-reconciliation.test.ts` | Webhook receipt, persistence, replay, and reconciliation behavior. |

## Stripe GA Surface Compared to Payable

The inspected Stripe GA spec exposes broad areas beyond the current provider:

| Stripe area | Example paths | Classification |
| --- | --- | --- |
| Checkout | `/v1/checkout/sessions` | Current scope. Improve only within existing checkout DTOs. |
| Payment Intents | `/v1/payment_intents` and confirm/capture/cancel endpoints | Current direct-charge foundation. Advanced intent lifecycle is a future optional capability. |
| Setup Intents | `/v1/setup_intents` | Optional capability candidate. |
| Refunds | `/v1/refunds`, charge refunds | Current scope for create refund; advanced cancel/retrieve/list is future. |
| Disputes | `/v1/disputes` | Optional capability candidate. |
| Balance/balance transactions | `/v1/balance`, `/v1/balance_transactions` | Settlement or Treasury track. |
| Payouts | `/v1/payouts` | Settlement track. |
| Transfers | `/v1/transfers` | Connect/Treasury track, not current `PaymentProvider`. |
| Payment methods | `/v1/payment_methods`, customer payment methods | Optional capability candidate. |
| Customers | `/v1/customers` | Current scope; advanced tax IDs, cash balance, and search are future. |
| Subscriptions | `/v1/subscriptions` | Current scope; schedules, migration, metered usage, and advanced invoices are future. |
| Invoices | `/v1/invoices` | Current invoice listing/PDF scope; create/finalize/pay/update is future. |
| Tax | `/v1/tax/*` | Optional/future capability. |
| Terminal | `/v1/terminal/*` | Future module. |
| Connect/accounts | `/v1/accounts/*` | Future module, likely separate from `PaymentProvider`. |
| Treasury | `/v1/treasury/*` | Separate Treasury RFC. |
| Issuing | `/v1/issuing/*` | Out of scope. |
| Identity | `/v1/identity/*` | Out of scope. |
| Financial Connections | `/v1/financial_connections/*` | Out of scope. |
| Webhook endpoint management | `/v1/webhook_endpoints` | Optional provider-side webhook endpoint capability candidate. |

## Limitations and Gaps

| Gap | Classification | Technical note |
| --- | --- | --- |
| Checkout does not expose all modern Stripe Checkout options | Adapt | Add only generic options that another provider can represent or keep Stripe-specific options provider-local. |
| Direct charge maps only create Payment Intent | Adapt/future | Capture, confirmation, cancellation, customer balance, and microdeposit flows need a generic intent lifecycle before entering core. |
| No setup intent support | Create optional capability candidate | Needs provider-neutral saved-payment setup DTOs. |
| Refund support is create-focused | Adapt | Current DTO can support common refunds. Advanced cancellation/listing/dispute linkage needs new DTOs. |
| No disputes capability | Create optional capability candidate | Stripe and Revolut Merchant both justify analysis, but evidence/challenge models need careful design. |
| No settlement/payout reports | Create optional settlement track | Balance transactions and payouts should not be hidden inside `PaymentProvider`. |
| No payment method management | Create optional capability candidate | Stripe and Revolut Merchant both have customer payment methods. |
| Advanced customers not modeled | Future | Tax IDs, cash balance, and search are provider-specific until a generic need exists. |
| Advanced subscriptions not modeled | Adapt/future | Usage/metered billing and schedules need a separate subscription enhancement plan. |
| Advanced invoices not modeled | Adapt/future | Invoice creation/finalization/payment should not be squeezed into invoice PDF/listing. |
| Tax not modeled | Future optional | Stripe Tax is a product surface, not just a field on line items. |
| Connect, Treasury, Terminal, Issuing, Identity | Out of current scope | These require separate modules or RFCs. |

## Safe Evolution Path

1. Keep the Stripe SDK optional and loaded only through dynamic import.
2. Keep all Stripe request/response shapes inside `src/infrastructure/providers/stripe`.
3. Add mapper and webhook improvements only when existing Payable DTOs/events can represent the
   behavior honestly.
4. Add focused tests before changing provider behavior.
5. Propose new optional capabilities through an RFC when the capability is generic and at least two
   providers justify it.
6. Keep Treasury, Connect, Terminal, Issuing, Identity, and Financial Connections outside the payment
   provider until separately approved.

## Breaking Changes Avoided

The near-term roadmap must avoid:

- Renaming or widening `PaymentProvider` required methods.
- Requiring custom providers to implement Stripe-specific concepts.
- Importing Stripe SDK types into core domain/application code.
- Moving `stripe` from optional peer dependency to required dependency.
- Changing current DTO status values without migration and compatibility analysis.
- Treating unmapped Stripe webhook events as processing failures.

## Proposed Stripe Roadmap

| Phase | Scope | Acceptance |
| --- | --- | --- |
| Stripe 1 | Mapper/status and webhook normalization gaps for existing DTOs/events | No contract changes; focused tests pass. |
| Stripe 2 | Checkout and Payment Intent option review | Only provider-neutral options enter DTOs; Stripe-only options stay out of core. |
| Stripe 3 | Payment methods/setup intent RFC | New optional capability only after Revolut Merchant fit is also documented. |
| Stripe 4 | Disputes/settlement RFC | Separate operational DTOs and storage/query design. |
| Stripe 5 | Treasury/Connect exclusion or RFC | No Treasury/Connect additions to `PaymentProvider`. |

## Test Plan for Future Stripe Work

For each implementation PR:

- Add or update tests before provider code changes.
- Run the focused Stripe test file that covers the behavior.
- Run related capability-guard tests when capabilities are involved.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run `npm run verify:bundle`.
- Run `npm run verify:exports`.
- Confirm `composer test` is not applicable unless a future `composer.json` is introduced.
