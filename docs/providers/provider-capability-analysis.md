# Provider Capability Analysis

This document uses Stripe and Revolut as reference providers to define a provider capability
roadmap for Payable. It is an analysis document only. It does not approve provider code changes,
contract changes, exports, package metadata changes, or storage changes.

## Sources

- Payable source, tests, and existing documentation in this repository.
- Stripe official OpenAPI repository: <https://github.com/stripe/openapi>, latest GA spec
  `2026-06-24.dahlia`.
- Revolut official OpenAPI repository: <https://github.com/revolut-engineering/revolut-openapi>,
  Merchant API `2026-04-20` and Business API `1.0`.

The Revolut Developer Portal blocked programmatic access with a Cloudflare challenge during the
analysis. The Revolut OpenAPI repository is the primary Revolut source used here.

## Current Architecture

Payable currently models billing and payment providers through `PaymentProvider`. The required
contract is intentionally small:

- `name`
- `capabilities()`
- `createCheckoutSession(input, ctx)`
- `refund(input, ctx)`

Additional behavior is exposed through optional capability interfaces and runtime guards. Existing
optional interfaces cover customers, catalog, subscriptions, direct subscriptions, charges,
invoices, billing portal, webhooks, and redirect callbacks.

This architecture works well for billing providers, but it does not currently model treasury or
banking resources such as accounts, counterparties, transfers, exchange, financial accounts, or
banking transactions.

## Capability Taxonomy

| Area | Existing fit | Recommendation |
| --- | --- | --- |
| Checkout | Current `PaymentProvider` scope | Keep in the base provider contract. |
| Charges and payment intents | Current optional `ChargeCapable` scope | Keep generic. Improve DTOs only when multiple providers need the same shape. |
| Setup intents | Not modeled | Candidate optional capability for saving or setting up payment methods. |
| Payment methods | Not modeled directly | Candidate optional capability if tied to customer payment method management. |
| Refunds | Current base provider contract | Keep in the base provider contract. Advanced refund operations can be optional. |
| Customers | Current optional capability | Keep generic. Avoid provider-specific profile fields in domain DTOs. |
| Catalog and prices | Current optional capability | Keep generic. Advanced price features should stay provider-specific until shared. |
| Subscriptions | Current optional capabilities | Keep generic. Add advanced subscription capability only for shared lifecycle behavior. |
| Invoices | Current optional capability | Keep generic. Add write-side invoice operations only after a separate contract review. |
| Billing portal | Current optional capability | Keep generic. |
| Webhooks | Current optional capability | Keep generic. Preserve raw provider events when no normalized event exists. |
| Disputes | Not modeled | Candidate optional capability, but only after defining generic dispute states and evidence rules. |
| Balance and balance transactions | Not modeled | Candidate reporting capability. Do not mix with stored payment ledger semantics. |
| Payouts and settlement reports | Not modeled | Candidate reporting or settlement capability. Needs careful provider terminology. |
| Tax | Not modeled | Candidate optional capability. Keep tax calculation separate from product catalog until proven shared. |
| Treasury and banking | Not modeled | Separate track. Do not force into `PaymentProvider`. |
| Connect, Terminal, Issuing, Identity, cards, team, accounting | Not modeled | Future or provider-specific modules unless explicitly approved. |

## Cross-provider Matrix

| Capability | Payable today | Stripe | Revolut Merchant | Revolut Business | Classification |
| --- | --- | --- | --- | --- | --- |
| Checkout | Yes | Checkout Sessions | Orders with checkout URL and token | No | Current Payable scope |
| Charges | Yes | PaymentIntents | Order payment lifecycle | No | Current optional capability |
| Setup intents | No | SetupIntents | Customer payment methods exist | No | Possible optional capability |
| Payment methods | No | PaymentMethods and customer payment methods | Customer payment methods | No | Possible optional capability |
| Refunds | Yes | Refunds | Order refunds | No | Current Payable scope |
| Customers | Yes | Customers | Customers | No | Current optional capability |
| Catalog and prices | Yes | Products and Prices | Subscription plans and order line items | No | Current optional capability with provider gaps |
| Subscriptions | Yes | Subscriptions and schedules | Subscriptions and plans | No | Current optional capability with future extensions |
| Invoices | Read and PDF | Invoices and invoice payments | Reports and settlement data, not same model | No | Current plus future optional writes |
| Billing portal | Yes | Billing Portal | No direct equivalent found in spec | No | Current optional capability |
| Webhooks | Yes | Events and webhook endpoints | Merchant webhooks | Business webhooks v2 | Current provider capability, plus future endpoint management |
| Disputes | No | Disputes | Disputes | No | Possible optional capability |
| Balance transactions | No | Balance and balance transactions | Payout and report data | Transactions | Possible reporting capability |
| Payouts | No | Payouts | Payouts | Payout links | Possible settlement capability |
| Transfers | No | Transfers and Treasury transfers | No | Transfers and payments | Treasury track |
| Accounts | No | Connect accounts and Treasury financial accounts | No | Accounts | Treasury track, not `PaymentProvider` |
| Counterparties | No | Treasury counterparties are not the same model | No | Counterparties | Treasury track |
| Exchange | No | Exchange rates only in core Stripe API | No | Foreign exchange | Treasury track |
| Issuing | No | Issuing | No | Cards exist but different domain | Future module |
| Identity | No | Identity | No | No | Future module |
| Terminal | No | Terminal | Terminals | No | Future module |
| Connect | No | Connect accounts and application fees | No | No | Future module |

## Architecture Recommendations

Keep `PaymentProvider` focused on billing and payment operations. It should not absorb treasury,
banking, identity, issuing, or terminal workflows.

Add optional capabilities only when they are generic enough to be implemented by more than one
provider without leaking provider vocabulary into domain DTOs. A good capability should have:

- a provider-neutral purpose,
- clear DTO boundaries,
- explicit idempotency behavior,
- normalized errors,
- provider-specific mappers,
- tests for at least one real provider and one fake provider,
- documentation that states capability gaps honestly.

Use separate provider modules or subpaths when a provider exposes a large product area that does not
belong in the core billing surface. Revolut Business API and Stripe Treasury are better candidates
for a treasury RFC than for expansion of `PaymentProvider`.

## Roadmap

### Phase 1: Analysis docs

Create the provider capability analysis, Stripe analysis, and Revolut analysis documents. No runtime
behavior changes.

### Phase 2: Low-risk provider improvements

Fix documentation drift, increase mapper coverage, expand webhook normalization only where the
domain already has normalized events, and add tests around current contracts.

### Phase 3: Optional capability proposals

Propose new optional capability interfaces for setup intents, payment methods, disputes, balance
reporting, payouts, tax, or webhook endpoint management only after reviewing at least Stripe and
Revolut fit.

### Phase 4: Treasury RFC

Draft a separate treasury design before adding accounts, counterparties, transfers, exchange,
financial accounts, or banking transactions. That RFC should decide contracts, DTOs, storage,
events, authorization, idempotency, and webhook reconciliation.

## Test Strategy

Documentation-only changes do not require runtime tests unless the docs tooling changes. Provider
or contract changes should run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:bundle
npm run verify:exports
```

This repository does not currently include `composer.json`; `composer test` is not applicable unless
PHP tooling is introduced later.

## Breaking Changes Avoided

- No change to `PaymentProvider`.
- No change to existing optional capability interfaces.
- No change to package exports.
- No change to provider behavior.
- No change to storage schemas.
- No new dependency or peer dependency.
