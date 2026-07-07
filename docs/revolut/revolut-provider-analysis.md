# Revolut Provider Analysis

This document analyzes how Revolut could fit Payable. It separates the Merchant API from the
Business API because they represent different domains. It is analysis only and does not approve a
Revolut implementation in this phase.

Sources inspected on 2026-07-07:

- Revolut OpenAPI repository: https://github.com/revolut-engineering/revolut-openapi
- Revolut Merchant OpenAPI spec: https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/json/merchant-2026-04-20.json
- Revolut Business OpenAPI spec: https://raw.githubusercontent.com/revolut-engineering/revolut-openapi/master/json/business.json
- Payable provider contract: `src/domain/contracts/payment-provider.contract.ts`
- Payable provider documentation: `docs/integrations/17-providers.md`

## Current Payable Fit

Payable currently has no Revolut provider. A future implementation should start with Revolut Merchant
because it is the Revolut surface that maps to merchant checkout, orders, customers, refunds,
subscriptions, disputes, payouts, and merchant webhooks.

Revolut Business should not be implemented as a `PaymentProvider`. It exposes account and banking
operations: accounts, counterparties, payments, transfers, exchange, transactions, team members, cards,
accounting categories, tax rates, and business webhooks. That belongs in a separate Treasury/Banking
track with its own contracts, storage, authorization, audit, and operational model.

## Merchant API Fit

The latest inspected Merchant spec is version `2026-04-20` with sandbox and production servers:

- Production: `https://merchant.revolut.com`
- Sandbox: `https://sandbox-merchant.revolut.com`

Relevant Merchant paths:

| Area | Paths | Payable fit |
| --- | --- | --- |
| Orders | `/api/orders`, `/api/orders/{order_id}`, capture, cancel, refund, payments | Best fit for `checkout`, payment lifecycle, and refunds. |
| Payment intents | `/api/orders/{order_id}/payment-intents`, `/api/payment-intents/{payment_intent_id}` | Likely Terminal/intent-specific; not first-phase checkout unless needed. |
| Customers | `/api/customers`, customer payment methods | Fits `customers`; payment methods need a future optional capability. |
| Subscriptions | `/api/subscription-plans`, `/api/subscriptions`, usages, cycles | Fits `subscriptions` only after lifecycle mapping is designed. |
| Disputes | `/api/disputes`, accept, evidence, challenge | Optional `DisputeCapable` candidate. |
| Payouts/reports | `/api/payouts`, `/api/report-runs` | Settlement/reporting track, not basic payments. |
| Webhooks | `/api/webhooks`, secret rotation, synchronous webhooks | Fits `webhooks`; endpoint management is a separate optional capability candidate. |
| Locations/terminals | `/api/locations`, `/api/terminals` | Future Terminal module. |

### Merchant Authentication and Versioning

The Merchant spec declares:

| Mechanism | Use |
| --- | --- |
| `Authorization: Bearer <secret api key>` | Main Merchant API server-call authentication. |
| `Revolut-Api-Version` | Required version header on versioned Merchant endpoints; inspected latest value is `2026-04-20`. |
| `Idempotency-Key` | Optional or required depending on endpoint. Mutating Payable calls should forward `ctx.idempotencyKey`. |
| `SSL` and `Revolut-Pay-Payload-Signature` | Fast checkout specific authentication/integrity mechanisms. Do not implement unless Fast checkout is explicitly scoped. |

A first Revolut Merchant provider should start with a small HTTP client that always sends the base URL,
API version, bearer key, idempotency key on mutating calls, and normalized errors. There is no current
local Revolut SDK dependency to keep optional, so the initial design should avoid adding a required SDK.

### Merchant Webhooks

The Merchant spec exposes webhook endpoint APIs and callback payload schemas. Event families include
orders, subscriptions, payouts, and disputes.

Initial webhook normalization should map only existing Payable domain events:

| Revolut Merchant event family | Initial mapping recommendation |
| --- | --- |
| Order completed/authorised/failed/cancelled | Map to payment/checkout outcomes only when payload contains enough order/payment state. |
| Subscription initiated/finished/cancelled/overdue | Map to subscription domain events only after lifecycle mapping is validated. |
| Dispute events | Persist with raw type until a dispute capability exists. |
| Payout events | Persist with raw type until a settlement capability exists. |

The verifier must throw `InvalidWebhookSignatureError` on invalid signatures and should keep raw event
storage behavior consistent with existing webhook infrastructure.

## Business API Fit

The Business spec is version `1.0` with sandbox and production servers:

- Production: `https://b2b.revolut.com/api/1.0`
- Sandbox: `https://sandbox-b2b.revolut.com/api/1.0`

Relevant Business paths:

| Area | Paths | Recommended boundary |
| --- | --- | --- |
| Accounts | `/accounts`, `/accounts/{account_id}`, bank details | Treasury account contracts. |
| Counterparties | `/counterparties`, `/counterparty`, delete counterparty | Treasury counterparty contracts. |
| Payments/transfers | `/pay`, `/transfer`, payment drafts, payout links | Treasury money-movement capability. |
| Exchange | `/rate`, `/exchange`, `/exchange-reasons` | Treasury exchange capability. |
| Transactions | `/transactions`, `/transaction/{id}` | Treasury transaction read model. |
| Webhooks | `/webhooks`, failed events, rotation | Treasury webhook handling. |
| Cards/team/accounting | `/cards`, `/team-members`, accounting categories, tax rates | Out of current Payable payment-provider scope. |

### Business Authentication

The Business spec declares bearer access-token authentication. The schema description says access
tokens expire and are refreshed with a refresh token; setup also involves JWT/client assertion
material. Because this is high-risk banking access, a future Business/Treasury provider should not
accept raw token logic embedded in provider methods.

Recommended future boundary:

```ts
interface RevolutBusinessTokenProvider {
  accessToken(): Promise<string>;
}
```

The concrete token provider can handle OAuth, refresh tokens, JWT signing, certificates, or secret
rotation outside the Treasury provider. The exact interface should be part of the Treasury RFC, not
the Merchant provider PR.

## Gap Analysis

| Gap | Classification | Technical justification |
| --- | --- | --- |
| Money representation | Reuse | Payable `Money` already uses integer minor units and currency codes, which matches Revolut amount/currency fields. |
| Idempotency | Reuse | `OperationContext.idempotencyKey` can be forwarded as `Idempotency-Key`. |
| Webhook storage and replay | Reuse | Existing webhook event storage can persist raw provider events and normalized types. |
| Error normalization | Adapt | Revolut errors must be wrapped into Payable errors at the provider boundary. |
| Status mapping | Create/adapt | Revolut order/payment/subscription states differ from Stripe and Payable value objects. Mapping needs focused tests. |
| Merchant HTTP client | Create | No local Revolut provider or SDK wrapper exists. The client must handle base URL, version header, auth, idempotency, JSON parsing, and errors. |
| Merchant webhook verifier | Create | Signature headers/algorithm need implementation from official Revolut webhook docs/spec details. |
| Merchant webhook normalizer | Create | Map only existing Payable events first; leave disputes/payouts raw until capabilities exist. |
| Merchant checkout mapping | Create/adapt | Revolut orders can implement hosted checkout, but DTO fit must be validated against required order fields. |
| Merchant refunds | Create | `refund` can map to order refund endpoint after payment/order id handling is designed. |
| Merchant customers | Create/adapt | Customer APIs exist; Payable DTOs cover only id/email/name, so advanced fields stay provider-local. |
| Merchant subscriptions | Future/adapt | Revolut subscription plans/usages/cycles need lifecycle mapping before implementation. |
| Disputes | Future/create | Both Stripe and Revolut support disputes; needs a generic `DisputeCapable` proposal. |
| Payouts/reports | Future/create | Settlement model needed before implementation. |
| Business accounts/transfers/exchange | Create separate module | Do not add these to `PaymentProvider`. |
| Existing provider contracts | Do not refactor now | Current contracts are sufficient for an initial Merchant provider subset. |
| Existing provider code | Do not remove | Stripe/Paddle/SISP behavior remains the compatibility baseline. |

## Proposed Revolut Roadmap

| Phase | Scope | Acceptance |
| --- | --- | --- |
| Revolut 1 | Merchant provider design note and test matrix | No code until DTO/status/auth/webhook choices are explicit. |
| Revolut 2 | Merchant HTTP client and error mapper | Internal infrastructure only; no public exports unless provider is ready. |
| Revolut 3 | Merchant checkout/orders and refunds | Implements current `PaymentProvider` core only; forwards idempotency and version headers. |
| Revolut 4 | Merchant webhooks | Verifier, normalizer for existing Payable events, replay compatibility tests. |
| Revolut 5 | Customers and subscriptions | Add only if existing DTOs can represent behavior without lying. |
| Revolut 6 | Optional capability RFCs | Payment methods, disputes, settlement, webhook endpoint management. |
| Revolut 7 | Business/Treasury RFC | Separate module for accounts, counterparties, transfers, exchange, and transactions. |

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Mixing Merchant and Business APIs | Payment provider becomes a banking provider | Keep Business behind a Treasury RFC. |
| Auth mistakes | Secret leakage or unauthorized banking actions | Use token-provider abstractions and header redaction; never log secrets. |
| Webhook verification ambiguity | Forged or rejected webhooks | Implement verifier from official docs and test invalid signatures. |
| API version drift | Runtime behavior changes | Require explicit Revolut API version in provider options, default to the documented version only after approval. |
| Lifecycle mismatch | Incorrect payment/subscription states | Build state mapping through tests before provider code. |
| Idempotency gaps | Duplicate provider operations | Forward idempotency on every mutating endpoint that accepts it; test request headers. |
| Overbuilding | Provider grows into every Revolut product | Start with Merchant core only; add optional capabilities via RFCs. |

## Test Plan for Future Revolut Work

For docs-only phases:

- No runtime tests are required unless documentation tooling is added.
- Verify only docs files are staged.
- `composer test` is not applicable because this repository has no `composer.json`.

For implementation phases:

- Write tests first for each mapper, header, error, and webhook behavior.
- Mock the Revolut HTTP transport at the provider boundary; do not call live Revolut APIs in unit tests.
- Cover sandbox/production base URL selection.
- Cover `Authorization`, `Revolut-Api-Version`, and `Idempotency-Key` forwarding.
- Cover error normalization and invalid webhook signatures.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`,
  `npm run verify:bundle`, and `npm run verify:exports`.
