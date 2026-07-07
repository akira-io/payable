# Stripe Provider Analysis

This document analyzes the existing `StripeProvider` and classifies possible Stripe-related
evolution against Payable's provider architecture. It is an analysis document only.

## Sources

- `src/infrastructure/providers/stripe/stripe-provider.ts`
- `src/infrastructure/providers/stripe/stripe-subscriptions.ts`
- `src/infrastructure/providers/stripe/stripe-mappers.ts`
- `src/infrastructure/providers/stripe/stripe-event-normalizer.ts`
- `src/infrastructure/providers/stripe/stripe-errors.ts`
- `src/infrastructure/providers/stripe/stripe-webhook-verifier.ts`
- `tests/stripe-provider.test.ts`, `tests/payments.test.ts`, `tests/webhooks.test.ts`,
  and `tests/stripe-amounts.test.ts`
- Stripe official OpenAPI repository: <https://github.com/stripe/openapi>, latest GA spec
  `2026-06-24.dahlia`

## Current State

`StripeProvider` is the reference implementation of `PaymentProvider`. It keeps the Stripe SDK as an
optional peer dependency and loads it lazily through `import('stripe')`. The provider pins
`STRIPE_API_VERSION` to `2026-06-24.dahlia`, which matches the official Stripe GA OpenAPI version
used for this analysis.

The constructor accepts:

- `secretKey`
- `webhookSecret`
- `logger`
- optional injected Stripe client for tests

The provider hides secrets from JSON serialization and Node inspection.

## Current Capabilities

| Capability | Status | Implementation |
| --- | --- | --- |
| Checkout | Supported | `checkout.sessions.create` |
| Customers | Supported | `customers.create`, `customers.update` |
| Catalog | Supported | `products.create`, `products.update`, `prices.create` |
| Subscriptions | Supported | Delegated to `StripeSubscriptions` |
| Trials | Supported | `trial_period_days` in checkout and direct subscriptions |
| Coupons | Supported | `discounts` in checkout and direct subscriptions |
| Billing portal | Supported | `billingPortal.sessions.create` |
| Charges | Supported | `paymentIntents.create` through `ChargeCapable` |
| Refunds | Supported | `refunds.create` |
| Invoices | Supported | `invoices.list`, `invoices.retrieve`, invoice PDF download |
| Webhooks | Supported | SDK signature verification plus event normalization |
| Idempotency forwarding | Supported | `ctx.idempotencyKey` forwarded to Stripe request options |

The declared capability set is honest for the current public surface, but it does not describe every
Stripe product that the SDK supports.

## DTOs and Mappers

Stripe SDK objects are mapped to Payable DTOs in `stripe-mappers.ts`:

- `CustomerDTO`
- `ProductDTO`
- `PriceDTO`
- `CheckoutSessionDTO`
- `SubscriptionDTO`
- `ChargeResultDTO`
- `RefundResultDTO`
- `InvoiceDTO`

Money conversion is handled in `stripe-amounts.ts`. Stripe wire amounts are converted against
Stripe-specific currency exponents, then reconciled with Payable's `Money` precision rules. This is
important for currencies where Stripe and ISO precision differ.

Provider states are mapped into Payable states with conservative defaults. Unknown payment and
refund states fall back to `pending`; unknown subscription states fall back to `incomplete`.

## Webhook Normalizer

`StripeEventNormalizer` maps known Stripe events to Payable `NormalizedEventName` values:

- checkout completed
- payment succeeded and failed
- customer created and updated
- subscription created, updated, cancelled, and resumed
- invoice created, paid, and payment failed
- refund created, succeeded, and failed

Unmapped events return `null` and are still preserved as raw webhook events. This is the correct
default because Stripe has many product areas that Payable does not model.

## Test Coverage

Existing tests cover:

- capabilities and secret redaction,
- customer creation and idempotency forwarding,
- price amount conversion,
- checkout sessions,
- billing portal sessions,
- pinned API version format,
- subscription webhook payload validation,
- basic Stripe error translation,
- charges through PaymentIntents,
- refunds and refund reason filtering,
- invoice listing and PDF download edge cases,
- Stripe currency exponent conversion,
- webhook verification and normalizer behavior.

Useful gaps remain:

- subscription create, update, cancel, and resume idempotency details,
- wider PaymentIntent and Refund status matrix tests,
- event normalizer coverage for every currently mapped event,
- error mapping for permission, API connection, and unknown Stripe errors,
- webhook behavior for important but currently unmapped events,
- invoice PDF content-type expectations, if the project wants to enforce them later.

## Opportunity Classification

| Stripe area | Classification | Notes |
| --- | --- | --- |
| Improved checkout | Current Payable scope | Add only generic fields that also fit other checkout providers. |
| PaymentIntents | Current optional capability | Already used by `ChargeCapable`; improve tests and mapper coverage first. |
| SetupIntents | Possible optional capability | Useful for saving payment methods; requires generic setup DTOs. |
| Advanced refunds | Current scope plus optional extension | Basic refunds exist. Cancellation, metadata updates, and retrieval need a separate contract. |
| Disputes | Possible optional capability | Needs generic dispute states, evidence handling, and webhook mapping. |
| Balance | Possible reporting capability | Read-only balance can be generic but must not be confused with Payable payment storage. |
| Balance transactions | Possible reporting capability | Useful for reconciliation and settlement. Needs provider-neutral transaction DTOs. |
| Payouts | Possible settlement capability | Stripe and Revolut both expose payout-like resources, but semantics differ. |
| Transfers | Treasury track or Connect track | Do not add to `PaymentProvider`. |
| Payment methods | Possible optional capability | Best paired with setup intents and customers. |
| Advanced customers | Future optional capability | Avoid leaking Stripe-specific customer fields. |
| Advanced subscriptions | Current scope plus future extension | Schedules, migration, proration controls, usage, and meter events need separate review. |
| Advanced invoices | Current scope plus future extension | Read-side exists. Write-side invoices need a new interface. |
| Tax | Possible optional capability | Stripe Tax maps to calculations and transactions, not only product tax categories. |
| Terminal | Outside current scope | In-person device workflows need their own module. |
| Connect | Outside current scope | Platform and connected-account concerns should not enter the billing provider contract by default. |
| Treasury | Separate treasury track | Related to accounts and money movement, not billing checkout. |
| Issuing | Outside current scope | Card issuing is a separate product area. |
| Identity | Outside current scope | Verification sessions and reports are not payment provider behavior. |

## Risks

- Expanding `PaymentProvider` with Stripe-only concepts would make every provider look incomplete.
- Mapping more webhook events without domain events could create false confidence. Raw event
  preservation is safer until the domain models the event.
- Stripe Connect, Treasury, Terminal, Issuing, and Identity each carry security and authorization
  rules that differ from billing flows.
- Write-side invoices, tax, and disputes introduce lifecycle rules that need storage and replay
  decisions if Payable is expected to reconcile them.
- More Stripe API methods increase test surface and require stronger optional peer bundle checks.

## Proposed Roadmap

### Phase 1: Documentation and tests

- Document the current provider accurately.
- Correct documentation that says Stripe SDK errors propagate unchanged; the code already maps
  several Stripe errors to `PayableError`.
- Add focused tests for current mapper and normalizer behavior before adding capabilities.

### Phase 2: Non-breaking provider improvements

- Improve mapper test coverage.
- Add safe event normalizer mappings only when the target `NormalizedEventName` already exists.
- Keep `StripeProviderOptions` backward compatible.
- Keep the SDK dynamic import and optional peer dependency.

### Phase 3: Optional capabilities

Evaluate setup intents, payment methods, disputes, balance reporting, payouts, tax, and invoice
writes as separate optional interfaces. Each proposal should include provider-neutral DTOs and at
least one non-Stripe feasibility check.

### Phase 4: Separate product modules

Keep Connect, Terminal, Treasury, Issuing, Identity, and Financial Connections outside the current
provider contract unless a dedicated module is approved.

## Breaking Changes Avoided

- No removal or rename of `StripeProvider`.
- No change to `StripeProviderOptions`.
- No change to the `PaymentProvider` contract.
- No static import of the Stripe SDK from the core bundle.
- No package export change during this analysis phase.

## Test Plan for Future Implementation

When implementation starts, run targeted tests first:

```bash
npm run test -- tests/stripe-provider.test.ts tests/payments.test.ts tests/webhooks.test.ts tests/stripe-amounts.test.ts
```

Before completion, run the full Node validation gate:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:bundle
npm run verify:exports
```
