# Overview

`@akira-io/payable` is a billing engine for Node.js that stays out of your stack's way. It is
framework, provider, storage, and queue agnostic: the core depends only on contracts, DTOs,
actions, value objects, and state machines, never on a provider SDK, HTTP framework, or database
client. You bring Stripe or Paddle, your storage, and your framework; the engine owns the billing
logic.

## The problem it solves

Adding billing to a Node.js backend usually forces three problems at once:

- **Billing complexity.** Subscriptions, trials, coupons, multi-item plans, swaps, cancellations,
  resumes, one-off charges, refunds, invoices, and webhook reconciliation each carry their own
  edge cases. The engine encapsulates these as explicit actions, pipelines, and state machines
  rather than ad hoc provider calls.
- **Provider lock-in.** Stripe and Paddle have different SDKs and event shapes. Payable hides both
  behind a single `PaymentProvider` contract (`src/domain/contracts/payment-provider.contract.ts`),
  so application code does not import a provider SDK directly.
- **Float money bugs.** Money is always handled in minor units through a `Money` value object
  backed by Dinero.js, so monetary logic never touches floats. `dinero.js` is the engine's only
  runtime dependency and ships inside the published bundle.

## Target users

Node.js backend developers who need Stripe or Paddle billing without committing to a specific HTTP
framework, database client, queue, or event system. The library reads nothing from the environment
itself (see System boundaries below); the integrating application injects every dependency.

## Key capabilities

- **Providers**: Stripe, Paddle, and SISP (regional Cabo Verde / vinti4 redirect provider) behind
  one `PaymentProvider` contract, via `StripeProvider`, `PaddleProvider`, and `SispProvider`.
- **Billing**: checkout, subscriptions (trials, coupons, multiple items, swap/cancel/resume),
  one-off charges, refunds, invoices, and the customer billing portal. Available through the fluent
  builders and the actions `CreateSubscriptionAction`, `SwapSubscriptionAction`,
  `CancelSubscriptionAction`, `CancelSubscriptionNowAction`, `ResumeSubscriptionAction`,
  `UpdateSubscriptionQuantityAction`, `ChargeAction`, `RefundPaymentAction`, `ListInvoicesAction`,
  and `DownloadInvoicePdfAction`.
- **Webhooks**: signature verification, event normalization, deduplication, async processing,
  local state reconciliation, and replay. Available through `ReceiveWebhookAction`,
  `ProcessWebhookAction`, `ProcessWebhookPipeline`, `ReplayWebhookAction`, `StoreWebhookEventAction`,
  and `StripeEventNormalizer` / `StripeWebhookVerifier`.
- **Reliability**: idempotency by default, an immutable audit log, and a transactional outbox.
  Available through `IdempotencyService`, `ExecuteIdempotentOperationAction`, `AuditService`, and
  `OutboxService`.
- **Storage / queue**: Knex storage driver (`KnexStorageDriver`, `migrate`) or Prisma storage
  adapter (exported via `./prisma`); synchronous (`SyncQueueDriver`) or BullMQ
  (`BullMQQueueDriver`) queue driver.
- **HTTP adapters**: Express, Fastify, and NestJS, each on its own subpath export
  (`./express`, `./fastify`, `./nest`). An MCP adapter (`./mcp`) exposes billing to AI clients.

## System boundaries - what it does NOT do

- **No UI.** The package ships only library code and HTTP route adapters. There are no view or
  template files.
- **No authentication or authorization of HTTP callers.** There is no built-in auth. Only the
  webhook routes are protected (by signature). The checkout and subscription-management routes take
  `billable` from the request body with no ownership check. Integrators must add their own auth and
  verify ownership of the `billable`.
- **No environment reading.** The library never calls `process.env`. The application reads its own
  secrets (such as `process.env.STRIPE_SECRET_KEY`) and passes them into `new StripeProvider(...)`;
  the reading happens in user code, not the library. Configuration is supplied entirely through
  `createPayable(config)` and injected drivers.
- **No bundled provider SDK, HTTP framework, or database client in the core.** Every such
  dependency is an optional peer, and the core runtime bundle imports none of them (see
  [02-architecture.md](02-architecture.md)).

---

[Previous: Index](00-index.md) · [Index](00-index.md) · [Next: Architecture](02-architecture.md)
