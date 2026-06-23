# Overview

`@akira-io/payable` is a Laravel Cashier-inspired billing engine for Node.js. Per `package.json`,
its description is "Laravel Cashier-inspired, framework/provider/storage/queue-agnostic billing
engine for Node.js." The current version is `0.1.0`.

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
  (`src/domain/value-objects/money.ts`) backed by Dinero.js. The README states monetary logic
  "never touches floats." `dinero.js` is a runtime dependency (`package.json` `dependencies`), and
  `tsup.config.ts` bundles it via `noExternal: ['dinero.js']`.

## Target users

Node.js backend developers who need Stripe or Paddle billing without committing to a specific HTTP
framework, database client, queue, or event system. The library reads nothing from the environment
itself (see System boundaries below); the integrating application injects every dependency.

## Key capabilities

The README lists the following features. Each is backed by exports in `src/index.ts`:

- **Providers**: Stripe and Paddle behind one `PaymentProvider` contract. Exported as
  `StripeProvider` and `PaddleProvider`.
- **Billing**: checkout, subscriptions (trials, coupons, multiple items, swap/cancel/resume),
  one-off charges, refunds, invoices, and the customer billing portal. Surfaced through the fluent
  builders (`src/application/builders`) and the actions exported from `src/index.ts`
  (`CreateSubscriptionAction`, `SwapSubscriptionAction`, `CancelSubscriptionAction`,
  `CancelSubscriptionNowAction`, `ResumeSubscriptionAction`, `UpdateSubscriptionQuantityAction`,
  `ChargeAction`, `RefundPaymentAction`, `ListInvoicesAction`, `DownloadInvoicePdfAction`).
- **Webhooks**: signature verification, event normalization, deduplication, async processing,
  local state reconciliation, and replay. Surfaced via `ReceiveWebhookAction`,
  `ProcessWebhookAction`, `ProcessWebhookPipeline`, `ReplayWebhookAction`, `StoreWebhookEventAction`,
  and `StripeEventNormalizer` / `StripeWebhookVerifier`.
- **Reliability**: idempotency by default, an immutable audit log, and a transactional outbox.
  Surfaced via `IdempotencyService`, `ExecuteIdempotentOperationAction`, `AuditService`, and
  `OutboxService`.
- **Storage / queue**: Knex storage driver (`KnexStorageDriver`, `migrate`); synchronous
  (`SyncQueueDriver`) or BullMQ (`BullMQQueueDriver`) queue driver.
- **HTTP adapters**: Express, Fastify, and NestJS, each on its own subpath export
  (`./express`, `./fastify`, `./nest` in `package.json` `exports`).

## System boundaries - what it does NOT do

- **No UI.** The package ships only library code and HTTP route adapters. There are no view or
  template files.
- **No authentication or authorization of HTTP callers.** The README states: "No built-in auth.
  Only the webhook routes are protected (by signature). The checkout and subscription-management
  routes take `billable` from the request body with no ownership check." Integrators must add their
  own auth and verify ownership of the `billable`.
- **No environment reading.** The library never calls `process.env`. The README's quick-start
  passes `process.env.STRIPE_SECRET_KEY` from the application into `new StripeProvider(...)`; the
  reading happens in user code, not the library. Configuration is supplied entirely through
  `createPayable(config)` and injected drivers.
- **No bundled provider SDK, HTTP framework, or database client in the core.** Every such
  dependency is an optional peer (`package.json` `peerDependencies` + `peerDependenciesMeta`),
  and the core runtime bundle imports none of them (enforced by `scripts/check-core-bundle.mjs`;
  see [02-architecture.md](02-architecture.md)).

---

[Previous: Index](00-index.md) · [Index](00-index.md) · [Next: Architecture](02-architecture.md)
