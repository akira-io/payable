# Troubleshooting

Common failures, their causes, resolutions, and how to diagnose them. Error codes referenced here
map to HTTP statuses.

## Webhook signature verification fails

Symptom: `INVALID_WEBHOOK_SIGNATURE` (HTTP 400) on `POST /webhooks`.

Causes and resolutions:

- Raw body was consumed by a JSON parser. On Express, a global `express.json()` mounted before the
  Payable router replaces the raw `Buffer`, and the handler throws `INVALID_WEBHOOK_PAYLOAD`
  (400) before verification. Mount the Payable router first; it installs its own
  `express.raw(...)` for the webhook routes.
- NestJS app not bootstrapped with `rawBody: true`. The controller reads `request.rawBody`; without
  it the payload is empty and verification fails. Create the app with
  `NestFactory.create(AppModule, { rawBody: true })`. See `docs/adapters/25-nestjs.md`.
- Wrong signing secret or wrong provider. The verifier uses the provider's configured secret.
  Confirm the secret matches the endpoint and the request is routed to the right provider.
- Wrong signature header. The header defaults to `stripe-signature`; if your provider sends a
  different header set `webhookSignatureHeader` in the adapter options.

Diagnose: check the response code (400 vs the `INVALID_WEBHOOK_PAYLOAD` 400) and the `error` field;
assert the verifier received the expected payload (`FakeProvider.lastVerifyInput?.payload` in
tests).

## "Provider ambiguous" error

Symptom: `WEBHOOK_PROVIDER_AMBIGUOUS` (HTTP 400).

Cause: more than one provider is registered and the webhook hit `/webhooks` (no `:provider`
segment). The facade throws when it cannot pick a default provider from more than one registered
name.

Resolution: route provider webhooks to `/webhooks/:provider` (for example `/webhooks/stripe`,
`/webhooks/paddle`) so the facade knows which verifier to use.

## ProviderCapabilityNotSupportedError

Symptom: `PROVIDER_CAPABILITY_NOT_SUPPORTED` (HTTP 422).

Cause: an operation was requested against a provider that does not implement that capability. The
error `context` carries `{ provider, capability }`.

Resolution: use a provider that supports the operation, or avoid the unsupported path. Inspect
`error.context.capability` to see which capability was missing.

## Idempotency conflict / in-progress

Symptoms: `IDEMPOTENCY_CONFLICT` (HTTP 409) or `IDEMPOTENCY_IN_PROGRESS` (HTTP 409).

Causes:

- `IDEMPOTENCY_CONFLICT`: the same idempotency key was reused with a different request payload. The
  error `context` carries `key`.
- `IDEMPOTENCY_IN_PROGRESS`: a request with the same key is still being processed.

Resolution: use a fresh key for a genuinely new request; reuse the exact same key only for an exact
retry of the same request. For in-progress, retry after the first request completes. See
`docs/features/14-idempotency.md`.

## Encryption key validation failure

Symptom: `ENCRYPTION_KEY_REQUIRED` thrown when constructing `NodeEncryptionDriver`.

Cause: the supplied key is empty or whitespace.

Resolution: pass a non-empty, high-entropy secret. A related `ENCRYPTION_INVALID_CIPHERTEXT` on
decrypt means the stored ciphertext is malformed or was produced with a different key/algorithm;
ensure the same key is used for encrypt and decrypt.

## Missing storage driver

Symptoms:

- `WEBHOOK_STORAGE_REQUIRED` (HTTP 500) when receiving or processing a webhook.
- `OUTBOX_STORAGE_REQUIRED` when calling `payable.outbox()`.

Cause: webhooks, the outbox, idempotency, charges, and subscriptions all need persistence, but no
`storage` driver was configured.

Resolution: pass a storage driver to `createPayable({ ..., storage })`. For Knex, construct
`KnexStorageDriver(db, clock)` and run `migrate(db)` first. See `docs/persistence/21-storage-knex.md`.

## BullMQ jobs not processing

Symptom: webhooks are received (`POST /webhooks` returns 200) but never reach `processed`; the
event row stays `pending`.

Causes and resolutions:

- Redis is unreachable or misconfigured. `BullMQQueueDriver` needs a valid `connection`; confirm
  Redis is up and the connection options are correct.
- No worker running. The worker for `webhook.process` starts lazily when `process` is called; with
  the BullMQ driver, ensure the process that registers the handler stays alive to consume jobs.
- For local development without Redis, use `SyncQueueDriver`, which runs the handler inline on
  dispatch - no worker needed.

Diagnose: check the job name is `webhook.process`, inspect the BullMQ queue in Redis, and watch the
`onFailed` callback if configured.

## Fastify or NestJS route returns 404

Symptom: a route you expect (for example `POST /refunds`, `POST /customers`, `GET /invoices`, or
`GET /payments`) returns 404 on Fastify or NestJS.

The three adapters are at route parity: Express, Fastify, and NestJS all implement the full route
set - refunds (create and list), customers, invoices, and payments included. None of these are 501
placeholders. A 404 therefore means the route was never mounted, not that the feature is missing.

Resolution: check the mount prefix and that you actually registered the plugin/module
(`createFastifyPayablePlugin` with the right `prefix`, or `PayableModule.forRoot(...)`). Confirm the
path is relative to the mount point. See `docs/adapters/24-fastify.md` and `25-nestjs.md`.

## Migration did not create tables

Symptom: repository calls fail because tables are missing.

Cause: `migrate(knex)` was not run, or was run against a different connection than the one the
storage driver uses.

Resolution: run `migrate(knex)` against the exact connection passed to `KnexStorageDriver`. It
creates billing and system tables and applies additive alters; it is safe to re-run.

---

[Previous: Operations](30-operations.md) | [Index](00-index.md) | [Next: FAQ](32-faq.md)
