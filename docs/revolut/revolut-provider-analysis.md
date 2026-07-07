# Revolut Provider Analysis

This document analyzes how Revolut fits Payable's provider architecture. It covers both the Revolut
Merchant API and the Revolut Business API, but it does not approve implementation.

## Sources

- Revolut official OpenAPI repository: <https://github.com/revolut-engineering/revolut-openapi>
- `json/merchant-2026-04-20.json`
- `json/business.json`
- Existing Payable provider contracts, webhooks, money handling, idempotency, tests, and docs

The Revolut Developer Portal blocked programmatic access with a Cloudflare challenge during the
analysis. The official OpenAPI repository is the source used here.

## Merchant API Fit

The Merchant API is the natural fit for `PaymentProvider`.

Merchant API `2026-04-20` exposes:

- production server `https://merchant.revolut.com`,
- sandbox server `https://sandbox-merchant.revolut.com`,
- `Authorization: Bearer <secretApiKey>`,
- request header versioning through `Revolut-Api-Version`,
- orders,
- customers,
- payments,
- subscriptions,
- payouts,
- disputes,
- report runs,
- webhooks,
- locations,
- terminals,
- payment intents.

Payable can map the Merchant API without changing the base provider contract for the first billing
surface:

| Payable behavior | Revolut Merchant fit |
| --- | --- |
| Checkout | Create an order and return the checkout URL or token. |
| Refund | Refund a completed order through the order refund endpoint. |
| Customers | Customer endpoints exist and can fit the current customer capability. |
| Subscriptions | Subscription plans and subscriptions exist, but need careful mapper design. |
| Webhooks | Merchant webhooks use HMAC signatures and fit `WebhookCapable`. |
| Idempotency | Merchant endpoints use `Idempotency-Key` headers for selected operations. |
| Money | Merchant order and refund amounts must map through `Money` without decimal drift. |

The main Merchant API identity concern is `order_id` versus `payment_id`. Payable has one
`providerPaymentId` on stored payments. For checkout and refunds, the safest first mapping is to use
the Revolut `order_id` as the canonical provider payment identifier and keep payment attempt IDs in
provider event payloads unless a generic payment-attempt model is approved.

## Merchant Webhooks

Merchant webhook callbacks include:

- `Revolut-Request-Timestamp`,
- `Revolut-Signature`,
- JSON payload with an `event` discriminator.

Supported Merchant event areas include orders, payments, subscriptions, payouts, and disputes.
Payable can normalize only the subset that maps to current `NormalizedEventName` values. Other
events should be stored and exposed as raw provider events until the domain supports them.

Header redaction must include Revolut signature and timestamp headers before webhook headers are
stored or logged.

## Business API Fit

The Business API is not a natural fit for `PaymentProvider`. It is a banking and treasury API.

Business API `1.0` exposes:

- production server `https://b2b.revolut.com/api/1.0`,
- sandbox server `https://sandbox-b2b.revolut.com/api/1.0`,
- `Authorization: Bearer <access_token>`,
- access token expiry of 40 minutes,
- refresh token flow referenced by the spec,
- token scopes `READ`, `WRITE`, `PAY`, and `READ_SENSITIVE_CARD_DATA`,
- accounts,
- counterparties,
- transactions,
- transfers,
- foreign exchange,
- payout links,
- webhooks v2,
- cards, team members, expenses, and accounting settings.

The Business API uses a different idempotency model from the Merchant API. Payments, account
transfers, and exchange requests use a `request_id` field in the request body. The payment request
description states that idempotency checks apply to transactions created within the last two weeks.

The OpenAPI spec confirms bearer tokens and scopes, but it does not provide enough machine-readable
detail to implement the full OAuth, JWT, certificate, and refresh-token bootstrap safely. A future
implementation should accept an `accessTokenProvider` or similar provider-neutral auth hook first,
then add a concrete token manager only after official flow docs are available.

## Capability Classification

| Revolut area | Classification | Reason |
| --- | --- | --- |
| Merchant orders for checkout | Current Payable scope | Maps to `createCheckoutSession`. |
| Merchant order refunds | Current Payable scope | Maps to `refund`. |
| Merchant customers | Current optional capability | Maps to customer create and update. |
| Merchant subscriptions | Possible current extension | Needs subscription DTO mapping and lifecycle tests. |
| Merchant payouts | Possible settlement capability | Similar name to Stripe payouts, but semantics require review. |
| Merchant disputes | Possible optional capability | Needs generic dispute states and evidence model. |
| Merchant reports | Future reporting capability | Useful for reconciliation but not a payment action. |
| Merchant terminals | Future module | Device and in-person workflows do not fit `PaymentProvider`. |
| Business accounts | Treasury track | Requires new treasury contracts. |
| Business counterparties | Treasury track | Requires new entity and validation model. |
| Business transfers and payments | Treasury track | Money movement with stronger authorization requirements. |
| Business exchange | Treasury track | Requires FX DTOs and idempotency behavior. |
| Business transactions | Treasury track | Read-side banking ledger, not Payable payment storage. |
| Business webhooks v2 | Treasury track | Events are banking events, not billing events. |
| Business cards, team, expenses, accounting | Outside current scope | Separate product areas. |

## Gaps

| Gap | Classification | Notes |
| --- | --- | --- |
| Revolut Merchant provider implementation | Create | Needs provider, client, mappers, errors, and webhook verifier. |
| Merchant API version header support | Create | Should default to `2026-04-20` and allow controlled override. |
| Revolut webhook signature redaction | Adapt | Add Revolut headers to redaction before storing webhook headers. |
| Revolut event normalization | Create | Normalize only events that match current domain events. |
| `order_id` and `payment_id` policy | Create | Needs explicit mapper policy before implementation. |
| Business API auth bootstrap | Create later | Start with token provider. Add full manager only with official docs. |
| Treasury contracts | Create later | Required before accounts, counterparties, transfers, exchange, and transactions. |
| Treasury storage and events | Create later | Required only if Payable persists treasury state. |
| Treasury idempotency | Create later | Must handle Business API `request_id` and the two-week window. |

## Risks

- Mixing Business API resources into `PaymentProvider` would blur billing and treasury boundaries.
- Revolut Merchant `order_id` and `payment_id` can create reconciliation ambiguity if Payable stores
  the wrong identifier as `providerPaymentId`.
- Business API `PAY` scope can initiate money movement. That requires a stronger authorization
  design than the current billing write flows.
- Access tokens, refresh tokens, and JWT material must never be serialized, logged, or stored
  without an explicit secret handling policy.
- Merchant webhooks and Business webhooks have different event models. They should not share one
  normalizer unless the normalized output is domain-owned.
- Business API amounts use decimal numbers in the OpenAPI schemas. Payable should keep using
  `Money` at boundaries and convert with explicit currency rules.

## Proposed Roadmap

### Phase 1: Merchant provider RFC

Design `RevolutProvider` for Merchant checkout, refunds, customer support, webhooks, error mapping,
money conversion, and idempotency forwarding.

### Phase 2: Merchant implementation

Implement the Merchant provider without changing `PaymentProvider`. Keep configuration plain,
secrets redacted, and all HTTP calls behind a small provider-local client.

### Phase 3: Shared optional capabilities

Compare Stripe and Revolut before adding optional capabilities for disputes, payouts, reports,
payment methods, setup flows, and webhook endpoint management.

### Phase 4: Treasury RFC

Create a separate treasury design for accounts, counterparties, transfers, exchange, and banking
transactions. The RFC should decide whether Payable only proxies these operations or also persists
treasury state.

## Test Plan for Future Implementation

For a Merchant provider implementation:

- unit-test provider capabilities,
- verify API version and authorization headers,
- test idempotency header forwarding where supported,
- test `Money` conversion for decimal and zero-decimal currencies,
- test `order_id` mapping policy,
- test refund full and partial paths,
- test webhook HMAC verification and invalid signatures,
- test raw event persistence for unmapped events,
- test error normalization,
- test secret redaction through JSON and inspection.

For a Treasury implementation:

- test token provider behavior without storing secrets,
- test request ID generation and forwarding,
- test the two-week idempotency warning in docs and code comments where relevant,
- test accounts, counterparties, transfers, exchange, and transactions through provider-neutral DTOs,
- test authorization boundaries for money movement.

## Breaking Changes Avoided

- No Business API behavior is added to `PaymentProvider`.
- No Revolut-specific DTO is added to the domain during this analysis phase.
- No storage schema is introduced for treasury state.
- No dependency or package export is added.
