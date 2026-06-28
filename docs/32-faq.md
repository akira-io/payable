# FAQ

Common developer questions about `@akira-io/payable`.

## Why minor units and a Money value object?

Monetary amounts are integers in the currency's minor unit (cents), wrapped in `Money`. The Express
refund route, for example, builds `Money.of(body.amount.amount, body.amount.currency)`, and stored
payments carry integer `amount` fields (`amount: 9900` for USD 99.00). Integer minor units avoid
floating-point rounding errors in money math; `Money`, backed by `dinero.js`, keeps amount and
currency together. See `docs/domain/06-value-objects.md`.

## Why are providers and storage peer-optional?

So the core stays framework- and provider-agnostic and adds nothing to a consumer's bundle that
they did not opt into. Every integration is an optional peer dependency - `stripe`,
`@paddle/paddle-node-sdk`, `@akira-io/sisp`, `knex`, `@prisma/client`, `bullmq`, `express`,
`fastify`, `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, `@modelcontextprotocol/sdk`, and
`@fastify/rate-limit` - and the bundle check enforces that none of them is statically imported into
the core entry. You install only the provider, storage, queue, and framework you actually use.

## Does it read environment variables?

No. The library reads no environment variables. You pass every dependency - providers, storage
driver, queue driver, encryption driver, Redis connection - into `createPayable(config)`. Secret
management is the host application's job.

## Do I need a database?

For stateless checkout you can run without one - a checkout session can be created with no storage.
But webhooks, idempotency, charges, and subscriptions need persistence. Receiving a webhook without
a storage driver throws `WEBHOOK_STORAGE_REQUIRED`; the outbox throws `OUTBOX_STORAGE_REQUIRED`.
Configure a storage driver (Knex) for any persistent flow.

## Sync queue or BullMQ?

Both implement the same `QueueDriver` contract. `SyncQueueDriver` runs the job handler inline on
dispatch, in-process, with no Redis and no retries - ideal for tests and simple deployments.
`BullMQQueueDriver` enqueues to Redis and runs jobs on a worker with configurable attempts and
exponential backoff - for production async processing. Webhook processing uses the job name
`webhook.process` either way. See `docs/persistence/22-queue.md`.

## Stripe vs Paddle - are they at parity?

Both ship as providers with a provider implementation, webhook verifier, and event normalizer.
Capability differences surface at runtime as `ProviderCapabilityNotSupportedError` (HTTP 422) when
an operation is not supported by the selected provider. Check `docs/integrations/18-stripe.md` and
`19-paddle.md` for per-provider capability detail.

## Is there built-in authentication?

No. No adapter installs authentication or guards. The only cryptographic check is webhook signature
verification. Authorization policies exist, but only `CanReplayWebhookPolicy` is wired into an
action today, and policies enforce business rules from an explicit context rather than
authenticating requests. You authenticate the caller and verify ownership of the billable. See
`docs/28-security.md`.

## Which HTTP routes does each adapter expose?

All three are at route parity. Express, Fastify, and NestJS each implement the full set: webhooks,
checkout, subscription management, customers, invoices, payments, products, prices, and refunds
(create and list). None of these are 501 placeholders. See `docs/adapters/23-express.md`,
`24-fastify.md`, and `25-nestjs.md`.

## How do I add a provider?

Implement the `PaymentProvider` contract - including `verifyWebhook` and `reconcileSubscription` -
and register it under a name in the config:
`createPayable({ providers: { myProvider: new MyProvider() } })`. The `ProviderRegistry` resolves
providers by name and throws `ProviderNotFoundError` for an unknown one. With multiple providers,
route webhooks to `/webhooks/:provider`. See `docs/integrations/17-providers.md`.

## How is the changelog generated?

By git-cliff from conventional commit messages, configured in `cliff.toml`, run by the release
workflow on a `vX.Y.Z` (or `vX.Y.Z-*`) tag. `feat`, `fix`, `perf`, and `refactor` commits appear in
the changelog; `docs`/`style`/`test`/`ci`/`chore` are skipped. `CHANGELOG.md` is generated - do not
hand-edit it.

## Which Node versions are supported?

Node `>=20`. CI runs the suite on Node 20 and 22, and the build targets `node20`.

## How do I run a single test?

Use Vitest directly: `npx vitest run -t "test name"` to select by name, or
`npx vitest run tests/express.test.ts` to select by file. See `docs/29-development.md`.

---

[Previous: Troubleshooting](31-troubleshooting.md) | [Index](00-index.md)
