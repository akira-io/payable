# Provider Capability Analysis: Stripe + Revolut

This document uses Stripe and Revolut as reference providers for a provider-agnostic Payable
capability roadmap. It is analysis only. It does not approve provider code, new contracts, storage
tables, exports, package metadata, or public API changes.

Sources inspected on 2026-07-07:

- Stripe OpenAPI repository: https://github.com/stripe/openapi
- Stripe GA OpenAPI spec: https://raw.githubusercontent.com/stripe/openapi/master/latest/openapi.spec3.json
- Revolut OpenAPI repository: https://github.com/revolut-engineering/revolut-openapi
- Revolut Merchant OpenAPI spec: https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/json/merchant-2026-04-20.json
- Revolut Business OpenAPI spec: https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/json/business.json

## Current Payable Boundary

Payable has one payment-provider contract, `PaymentProvider`, plus optional structural capability
interfaces. The core contract is intentionally narrow: provider name, `capabilities()`,
`createCheckoutSession`, and `refund`. Optional provider methods are surfaced through capability
guards such as `CustomerCapable`, `CatalogCapable`, `WebhookCapable`, `ChargeCapable`,
`DirectSubscriptionCapable`, `InvoiceCapable`, and `BillingPortalCapable`.

The current known capability values are:

| Capability | Current meaning |
| --- | --- |
| `checkout` | Hosted checkout or provider redirect checkout. |
| `charges` | Direct payment creation through `ChargeCapable`. |
| `subscriptions` | Subscription management and direct subscription creation when the provider also implements it. |
| `trials` | Trial support for subscription checkout or direct subscription creation. |
| `refunds` | Refund support through the required `refund` method. |
| `coupons` | Coupon or discount support in checkout/subscription flows. |
| `billingPortal` | Provider-hosted billing portal. |
| `meteredBilling` | Declared capability only; not currently implemented by built-in providers. |
| `invoicePdf` | Invoice listing and PDF download through `InvoiceCapable`. |
| `webhooks` | Signed asynchronous webhook verification and normalization through `WebhookCapable`. |
| `customers` | Provider-backed customer creation and update. |
| `catalog` | Provider-backed products and prices. |

The important design rule is that provider-specific APIs must stay behind providers. Payable core
may know a generic capability, DTO, status, or error model, but it must not import a provider SDK or
leak a provider-specific endpoint shape into the domain.

## Capability Taxonomy

### Current Payment Scope

These features already exist in Payable or fit the current payment-provider model without changing
the core philosophy:

| Area | Current fit |
| --- | --- |
| Checkout/orders | `checkout` and `createCheckoutSession`. Revolut Merchant orders fit this area; Stripe Checkout already implements it. |
| Direct charges/payment intents | `charges` and `ChargeCapable`. Stripe uses Payment Intents. Revolut Merchant has order payment and terminal payment-intent APIs, but direct-charge semantics need provider-specific mapping. |
| Refunds | Required provider method today. Stripe and Revolut Merchant both support refunds. |
| Customers | Existing optional customer capability. Stripe and Revolut Merchant both expose customer APIs. |
| Catalog/prices | Existing optional catalog capability. Stripe supports first-class products/prices. Revolut Merchant subscription plans are related but not identical. |
| Subscriptions | Existing optional subscription capability. Stripe and Revolut Merchant both expose subscription APIs, with different lifecycle models. |
| Invoices/billing portal | Existing invoice/PDF and billing portal concepts are Stripe-oriented today. Revolut Merchant does not map cleanly without a more generic "reports/receipts/documents" analysis. |
| Webhooks | Existing signed webhook pipeline. Stripe, Paddle, Revolut Merchant, and Revolut Business all expose webhook concepts. |
| Idempotency | Existing `OperationContext.idempotencyKey`; Stripe and Revolut Merchant specs both expose idempotency headers. |
| Mappers/error normalization | Existing provider-local mapper pattern. Every new provider should map into Payable DTOs and errors at the boundary. |

### Optional Capability Candidates

These features should be considered as optional generic capabilities only after a concrete proposal
shows stable DTOs and at least two providers justify the shape:

| Candidate | Why it is optional |
| --- | --- |
| Setup intents / mandates | Stripe has Setup Intents. Revolut has saved payment methods and recurring/subscription flows, but the concepts are not identical. |
| Payment methods | Stripe and Revolut Merchant both expose customer payment methods. A generic capability needs a provider-neutral token, status, and deletion model. |
| Disputes | Stripe and Revolut Merchant both expose disputes, evidence, and challenge flows. This is operational and should not be forced into basic payments. |
| Balance transactions | Stripe exposes balance and balance-transaction APIs. Revolut Merchant exposes payouts and reports. A generic settlement/reporting model is needed first. |
| Payouts / settlement reports | Stripe payouts and Revolut Merchant payouts/report-runs overlap, but not enough to add directly to `PaymentProvider` without a settlement capability design. |
| Tax | Stripe Tax is broad. Revolut Merchant order line items include tax data, but it is not the same as a tax calculation product. |
| Enhanced invoices/subscriptions | Both providers have deeper billing surfaces than Payable currently models. Additions should be incremental and generic. |
| Webhook endpoint management | Stripe and Revolut both have webhook endpoint APIs. Payable already has local webhook endpoints; provider-side registration needs a separate decision. |

### Treasury Track

Treasury and banking capabilities must not be forced into `PaymentProvider`. Stripe and Revolut both
have APIs in this space, but their domain is accounts and money movement, not merchant checkout:

| Treasury area | Stripe reference | Revolut Business reference | Recommended boundary |
| --- | --- | --- | --- |
| Accounts | Connect accounts and Treasury financial accounts | `/accounts` and bank details | Separate treasury/account contracts. |
| Counterparties | External accounts and Treasury counterparties | `/counterparties` and `/counterparty` | Separate counterparty DTOs and validation. |
| Transfers/payments | Connect transfers, Treasury outbound payments/transfers | `/pay`, `/transfer`, payment drafts, payout links | Separate money-movement capability with stronger authorization. |
| Exchange/FX | Not a PaymentProvider concern; Stripe has FX effects in balance/settlement | `/rate`, `/exchange`, `/exchange-reasons` | Separate exchange capability and audit model. |
| Banking transactions | Balance transactions and financial accounts | `/transactions`, `/transaction/{id}` | Separate ledger/transaction read model. |

This should be drafted as a Treasury RFC before adding contracts, storage, or provider code.

### Future or Out of Scope

These areas stay outside the current Payable payment roadmap until explicitly approved:

| Area | Reason |
| --- | --- |
| Stripe Connect | Marketplace onboarding, account lifecycle, and platform liability are larger than the current provider model. |
| Stripe Terminal | In-person reader workflows need separate device/session state. |
| Stripe Issuing | Card issuing is not billing. |
| Stripe Identity | KYC/verification is not payment-provider billing. |
| Stripe Financial Connections | Bank-account aggregation belongs outside `PaymentProvider`. |
| Revolut cards/team/accounting | Business administration and card operations belong in a future Business/Treasury module, not payment checkout. |
| Revolut crypto/open banking/Revolut X | Separate product domains. |

## Cross-Provider Matrix

| Capability area | Stripe GA spec | Revolut Merchant 2026-04-20 | Revolut Business 1.0 | Payable classification |
| --- | --- | --- | --- | --- |
| Hosted checkout/orders | `/v1/checkout/sessions` | `/api/orders` | No direct checkout equivalent | Current scope. |
| Direct payment creation | `/v1/payment_intents` | `/api/orders/{order_id}/payments`, `/api/payment-intents/{id}` | `/pay` is banking payment, not checkout | Current Stripe scope; Revolut needs careful provider mapping. |
| Setup/saved payment setup | `/v1/setup_intents`, `/v1/payment_methods` | customer payment methods | No payment checkout equivalent | Optional capability candidate. |
| Refunds | `/v1/refunds`, charge refunds | `/api/orders/{order_id}/refund` | Not payment-provider refund | Current scope. |
| Customers | `/v1/customers` | `/api/customers` | Not payment-provider customer | Current optional capability. |
| Catalog/prices/plans | `/v1/products`, `/v1/prices` | `/api/subscription-plans` | Not payment-provider catalog | Current Stripe scope; Revolut may need subscription-plan mapping. |
| Subscriptions | `/v1/subscriptions` | `/api/subscriptions` | No merchant subscription equivalent | Current optional capability with provider-specific lifecycle mapping. |
| Invoices/PDF | `/v1/invoices` | Reports and order/payment data, not invoice-PDF parity | No merchant invoice equivalent | Current Stripe scope; generic document/report capability needs analysis. |
| Billing portal | `/v1/billing_portal/sessions` | No direct equivalent in inspected Merchant spec | No equivalent | Stripe-only current capability. |
| Webhooks | event + webhook endpoint APIs | `/api/webhooks`, callback event schemas | `/webhooks`, failed events | Current webhook capability plus future endpoint-management candidate. |
| Disputes | `/v1/disputes` | `/api/disputes` | No payment dispute domain | Optional capability candidate. |
| Balance transactions | `/v1/balance`, `/v1/balance_transactions` | payout/report data | `/transactions` is banking transaction data | Settlement/Treasury track, not core payments. |
| Payouts | `/v1/payouts` | `/api/payouts`, `/api/report-runs` | payout links exist but are business money movement | Optional settlement track. |
| Transfers | `/v1/transfers`, Treasury transfer APIs | No direct merchant transfer domain | `/transfer` | Treasury track. |
| Exchange/FX | Not a `PaymentProvider` feature | No merchant FX capability | `/rate`, `/exchange` | Treasury track. |
| Tax | `/v1/tax/*` | order line-item tax data | tax rates in Business admin | Optional/future; needs distinct tax model. |
| Terminal | `/v1/terminal/*` | `/api/terminals`, terminal payment intents | No merchant terminal equivalent | Future module. |
| Identity/issuing/cards | `/v1/identity/*`, `/v1/issuing/*` | Not merchant billing | `/cards`, `/team-members` | Out of scope. |

## Roadmap

### Phase 1 - Comparative Analysis

Scope: this document plus provider-specific Stripe and Revolut analysis.

Acceptance:

- No provider code changes.
- No contract, export, package, or metadata changes.
- Documentation identifies current scope, optional capability candidates, Treasury separation, and
  future/out-of-scope modules.

### Phase 2 - Low-Risk Stripe Improvements

Scope: changes that do not alter public contracts.

Candidate work:

- Expand Stripe mapper/status coverage where the current DTOs can already represent the value.
- Add missing webhook event normalizations only for existing Payable domain events.
- Tighten idempotency and error tests around existing Stripe calls.
- Correct or expand docs for current Stripe behavior.

Non-goals:

- New generic capability contracts.
- Revolut provider code.
- Stripe Connect, Terminal, Treasury, Issuing, Identity, or Financial Connections.

### Phase 3 - Generic Optional Capability Proposals

Scope: propose new provider-neutral capabilities only when the Payable architecture and at least two
providers justify them.

Candidate RFCs:

- `PaymentMethodCapable`
- `SetupIntentCapable` or a more generic saved-payment-setup capability
- `DisputeCapable`
- `SettlementCapable`
- `TaxCapable`
- Provider-side `WebhookEndpointCapable`

### Phase 4 - Revolut Merchant Provider

Scope: implement only the Merchant API pieces that fit current Payable contracts.

Candidate work:

- `RevolutMerchantProvider` using the existing `PaymentProvider` boundary.
- Merchant order checkout mapping.
- Merchant refunds.
- Customer mapping if the DTO contract is sufficient.
- Merchant webhook verifier and normalizer.
- Idempotency forwarding and API-version header handling.

Non-goals:

- Business API banking, transfers, accounts, exchange, cards, team, or accounting.
- Token refresh/JWT/certificate code unless the selected Revolut API flow requires it and has an
  approved abstraction.

### Phase 5 - Treasury RFC

Scope: design a separate Treasury module before adding accounts, counterparties, transfers, exchange,
or banking transactions.

Acceptance:

- No Treasury APIs are added to `PaymentProvider`.
- Security, audit, idempotency, authorization, and storage are designed before code.

## Risk Register

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Provider-specific leakage into core | Locks Payable to Stripe/Revolut shapes | Add only provider-neutral DTOs and keep SDK/OpenAPI details in provider adapters. |
| Capability inflation | A large interface becomes hard to implement | Keep `PaymentProvider` small; add optional capabilities only with evidence from multiple providers. |
| Treasury mixed with billing | Security and audit requirements are under-modeled | Keep a separate Treasury RFC and storage design. |
| Version drift | Provider specs change faster than Payable releases | Pin provider API versions in provider options/docs and test mapper behavior. |
| Webhook mismatch | Unknown events are persisted but not reconciled | Normalize only approved domain events and log unmapped provider events. |
| Idempotency inconsistency | Retries may duplicate provider operations | Forward `ctx.idempotencyKey` for all mutating calls that support it; test it. |
| Developer confusion | Users may expect all Stripe/Revolut APIs in one provider | Document current scope, optional capabilities, and out-of-scope areas clearly. |

## Test Plan

Report phase:

- No runtime tests are required for docs-only changes unless docs tooling is introduced.
- Verify changed docs are the only staged files.
- `composer test` is not applicable because this repository has no `composer.json`.

Implementation phases:

- Run focused tests for the changed provider/capability path.
- Run `npm run lint`.
- Run `npm run typecheck`.
- Run `npm run test`.
- Run `npm run build`.
- Run `npm run verify:bundle`.
- Run `npm run verify:exports`.
- If local full-suite blockers are environmental, document the exact failing command and run the
  widest non-blocked test command.
