# Reliability

Payable's reliability primitives keep state consistent when work is retried, replayed, or run
concurrently: a transactional outbox for at-least-once event delivery, an immutable audit log,
encryption at rest for sensitive webhook data, locks and a cache for concurrency control, and an
event bus for in-process domain events. Each primitive sits behind a domain contract so the
integrating application can supply its own driver.

## Transactional outbox

`OutboxService` (`src/infrastructure/outbox/outbox-service.ts`) delivers events that were staged in
the same database transaction as the state change that produced them. The webhook pipeline, for
example, writes the outbox row alongside the processed status, so an event is never lost if delivery
later fails.

**Contract.** `OutboxEventRepository` (`src/domain/contracts/outbox-event-repository.contract.ts`):

```ts
export interface OutboxEventRepository {
  create(data: NewOutboxEvent): Promise<OutboxEvent>;
  claimPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string, lockToken?: string | null): Promise<number>;
  markFailed(id: string, nextRetryAt: Date | null, lockToken?: string | null): Promise<number>;
}
```

An `OutboxEvent` carries `tenantId`, `correlationId`, `eventType`, `eventVersion`, `payload`,
`status` (`pending | processing | published | failed`), `attempts`, `nextRetryAt`, an optional
`lockToken`, and an optional `dedupeKey`. `NewOutboxEvent` is the same minus the engine-owned fields:

```ts
export type NewOutboxEvent = Omit<
  OutboxEvent,
  'id' | 'status' | 'attempts' | 'nextRetryAt' | 'lockToken' | 'createdAt' | 'updatedAt'
>;
```

**Idempotent create.** When a `dedupeKey` is supplied, `create` is idempotent on
`(dedupe_key, tenant_id)`: it pre-checks for an existing row and returns it, and if the insert races a
concurrent writer the unique violation is caught and the existing row re-queried. So reprocessing the
same webhook never stages a duplicate outbox row (the pipeline passes
`dedupeKey: webhook:<webhookEventId>:<normalizedType>`).

**Behavior.** `publishPending` claims a batch and delivers each one:

```ts
async publishPending(deliver: OutboxDelivery, limit = 50): Promise<OutboxPublishResult> {
  const events = await this.repository.claimPending(limit);
  const result = { published: 0, retried: 0, deadLettered: 0 };
  for (const event of events) await this.publishOne(event, deliver, result);
  return result;
}
```

- `claimPending` claims rows for the worker - the Knex repository selects claimable rows ordered by
  `(created_at, id)` with `forUpdate().skipLocked()`, flips them to `processing`, and stamps a
  per-claim `lockToken`, so concurrent workers never grab the same row.
- **Per-tenant fairness.** The claim is fair across tenants. The repository over-fetches candidates
  (`FAIR_OVERFETCH_FACTOR` of `5`, capped at `MAX_FAIR_OVERFETCH` `1000`) and then round-robins
  across per-tenant buckets via `fairlyOrdered()` before claiming, so one tenant with a large backlog
  cannot starve others within a single batch.
- **Lock token.** Each claimed row carries the `lockToken` minted when it was claimed.
  `markPublished` and `markFailed` are passed `event.lockToken` and only update the row when the token
  still matches; both return the number of rows affected. A `0` result means the claim was lost (the
  row was reclaimed by another worker), so the current worker stands down instead of double-marking.
  This guards against double-delivery when a slow worker's claim expires and another worker takes
  over.
- On successful delivery the row is `markPublished(event.id, event.lockToken)`; if it returns `0` the
  delivery is left for reclaim rather than counted as published.
- On failure, attempts are incremented. If `attempts >= maxAttempts` (`OutboxService` default `5`) the
  row is dead-lettered via `markFailed(id, null, lockToken)`. Otherwise it is scheduled for retry with
  exponential backoff and equal-jitter: the base delay `backoffMs * 2 ** (attempts - 1)` (default
  `backoffMs` `1000`) is capped at `maxBackoffMs` (default `60_000`), then half the cap plus a random
  portion of the other half is added to `now`, never exceeding `maxBackoffMs`.

**Two retry budgets.** There are two independent attempt ceilings, with different defaults:

- `OutboxService.maxAttempts` (default `5`, `src/infrastructure/outbox/outbox-service.ts`) - how many
  times the relay re-queues an outbox row before dead-lettering it.
- `WebhookDeliveryService.maxAttempts` (`DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS`, default `10`,
  `src/application/services/webhook-delivery/webhook-delivery-service.ts`) - how many per-endpoint
  HTTP delivery attempts before that endpoint's delivery is disabled.

They sit at different layers (durable relay vs. per-endpoint HTTP delivery) and are configured
separately. If you drive endpoint delivery from the outbox relay, set the two budgets deliberately so
the relay does not stop re-queuing long before - or long after - the delivery service stops retrying.

**Inputs/outputs.** Input is a `deliver` callback and an optional `limit`. Output is
`{ published, retried, deadLettered }` counts.

**Failure modes.** A delivery that keeps throwing is retried with growing backoff until the attempt
ceiling, then dead-lettered (status `failed`, no further retry). Delivery is at-least-once: a worker
that crashes after delivering but before `markPublished` will redeliver, so consumers must be
idempotent.

**When a driver is required.** `Payable.outbox()` throws `OUTBOX_STORAGE_REQUIRED` if no storage
driver is configured - the outbox needs a persistent repository.

## Immutable audit log

`AuditService` (`src/infrastructure/audit/audit-service.ts`) records an append-only trail of who did
what to which resource.

**Contract.** `AuditLogRepository` (`src/domain/contracts/audit-log-repository.contract.ts`):

```ts
export interface AuditLogRepository {
  create(data: NewAuditLog): Promise<AuditLog>;
  list(query: AuditLogQuery): Promise<AuditLog[]>;
  verifyChain(tenantId: string | null): Promise<boolean>;
  backfillChain(tenantId: string | null): Promise<number>;
}
```

An `AuditLog` (`src/domain/entities/audit-log.entity.ts`) carries `tenantId`, `correlationId`,
`actorType`, `actorId`, `action`, `resourceType`, `resourceId`, `before`, `after`, `metadata`,
`ipAddress`, `userAgent`, `previousHash`, `hash`, and `createdAt`. There is no `update` or `delete` on
the contract - entries are immutable.

**Behavior.** `record` maps the input to a `NewAuditLog`, defaulting every optional field to `null`:

```ts
async record(input: AuditEntryInput): Promise<AuditLog> {
  return this.repository.create(this.toRecord(input));
}
```

**What gets logged.** Any operation that wants a trail calls `record`. The webhook pipeline
(see [Webhooks](13-webhooks.md)) logs every processed event as `action: webhook.<type>`,
`actorType: 'provider'`, `actorId: <providerName>`, `resourceType: 'webhook_event'`, with
`before: null` and `after: <event data>`. The correlation id ties the audit entry back to the
originating request.

**Hash chain.** Each persisted entry links to the previous one, forming a per-tenant tamper-evident
chain. The Knex repository (`knex-audit-log.repository.ts`) appends inside a transaction: it reads the
latest entry for the tenant (locking the row on Postgres/MySQL/MariaDB), takes that row's `hash` as
the new entry's `previousHash`, and assigns `sequence = (latest.sequence ?? 0) + 1`. The entry `hash`
is computed by `auditEntryHash` (`src/infrastructure/audit/audit-chain.ts`) over the canonical payload
- `previousHash`, `sequence`, `createdAt`, and every logged field - keyed with the optional audit key
when configured. A unique `(tenant_id, sequence)` constraint serializes concurrent appends: a losing
writer hits a unique violation and retries (up to 50 attempts) against the new latest row.

- **Sequence semantics.** `sequence` is monotonic and contiguous **per tenant**, starting at `1`. A
  null tenant is keyed as `''`, so each tenant maintains its own independent chain.
- **Verification.** `AuditService.verify(tenantId)` delegates to `verifyChain`, which walks the chain
  in `sequence` order and, for each entry, recomputes the expected hash from the running
  `previousHash` and `sequence` via `auditLinkValid`. It checks that the stored `previousHash` matches
  the prior entry's `hash` and that the recomputed `hash` matches (compared with `timingSafeEqual`).
  Any mismatch returns `false`.

**Runtime backfill.** Legacy rows written before the chain existed have a null `sequence`.
`backfillChain(tenantId)` repairs them at runtime: in one transaction it loads the tenant's
null-`sequence` rows ordered by `created_at` then `id`, picks up from the current latest sequenced
entry, and assigns each a contiguous `sequence`, `previousHash`, and recomputed `hash` so the chain
becomes contiguous and verifiable. It returns the number of rows backfilled (`0` when there is
nothing to repair). `latest`, `verifyChain`, and `chainPage` only consider rows with a non-null
`sequence`, so unbackfilled legacy rows never break a fresh append.

**Failure modes.** `record` resolves to the persisted entry or rejects if the repository write
fails; there is no swallow. Reads are filtered through `ListAuditLogsQuery`.

## Encryption at rest

`NodeEncryptionDriver` (`src/infrastructure/encryption/node-encryption-driver.ts`) encrypts
sensitive values before they hit storage. It implements the `Encryption` contract
(`src/domain/contracts/encryption.contract.ts`): `encrypt(plaintext)` and `decrypt(ciphertext)`.

**Algorithm.** AES-256-GCM with a random 12-byte IV per encryption. The key is either a 32-byte raw
hex string (used directly) or a passphrase derived via scrypt with a **required** explicit salt;
ciphertext is serialized as the versioned envelope `v1:base64(iv):base64(tag):base64(ciphertext)`. The
full key-handling, salt requirement, and `legacyDerivedSalt` recovery path are documented in
[Security - Encryption at rest](../28-security.md); this section only covers what the engine encrypts.

**What it encrypts.** When an encryption driver is configured, the Knex webhook-event repository
(`src/infrastructure/storage/knex/repositories/knex-webhook-event.repository.ts`) seals the
`payload`, `data`, and `headers` columns on write and opens them on read. The columns then contain
ciphertext, not plaintext - the stored row does not contain the event id, email, or header secret.

**Failure modes.** An empty key throws `ENCRYPTION_KEY_REQUIRED` and a passphrase key with no salt
throws `ENCRYPTION_SALT_REQUIRED`, both at construction. Malformed ciphertext (wrong envelope, missing
IV/tag/data parts) throws `ENCRYPTION_INVALID_CIPHERTEXT`; a failed decrypt (including a verification
failure on the GCM auth tag for tampered ciphertext) throws `ENCRYPTION_DECRYPT_FAILED`.

**When required.** Encryption is optional. Without a driver the columns are stored in plaintext;
with one, all reads transparently decrypt.

## Locks

`LockDriver` (`src/domain/contracts/lock-driver.contract.ts`) provides distributed mutual exclusion
for concurrency-sensitive sections:

```ts
export interface LockDriver {
  acquire(key: string, ttlMs: number): Promise<Lock | null>;
  withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T>;
}
```

**Drivers.** Two implementations are scaffolded: `MemoryLockDriver` (single-process) and
`RedisLockDriver` (distributed, constructed with a Redis client). Both are marked Phase 7 and
currently throw `NOT_IMPLEMENTED` for `acquire` and `withLock`. Concurrency control today is enforced
primarily by the idempotency store's atomic `acquire`/`takeOver` (see [Idempotency](14-idempotency.md))
and the outbox's `forUpdate().skipLocked()` claim.

**When required.** A lock driver is opt-in (`locks` on `PayableConfig`). Use `MemoryLockDriver` for a
single instance and `RedisLockDriver` when multiple processes must coordinate.

## Cache

`CacheDriver` (`src/domain/contracts/cache-driver.contract.ts`) abstracts a key/value cache with
`get`, `set`, `delete`, and `has`. `MemoryCacheDriver` and `RedisCacheDriver` mirror the lock
drivers: memory for a single process, Redis for shared state. Both are Phase 7 scaffolds that throw
`NOT_IMPLEMENTED`. The cache is optional (`cache` on `PayableConfig`).

## Event bus

`EventBus` (`src/domain/contracts/event-bus.contract.ts`) dispatches domain events to in-process
listeners:

```ts
export interface EventBus {
  listen(name: string, listener: EventListener): void;
  emit(event: DomainEvent): Promise<void>;
}
```

**Default driver.** `InMemoryEventBus` (`src/infrastructure/event-bus/in-memory-event-bus.ts`) keeps
listeners in a map keyed by event name plus a `*` wildcard bucket. `emit` awaits each name-matched
listener, then each wildcard listener, in registration order:

```ts
async emit(event: DomainEvent): Promise<void> {
  const targeted = this.listeners.get(event.name) ?? [];
  const wildcard = this.listeners.get(WILDCARD) ?? [];
  for (const listener of [...targeted, ...wildcard]) await listener(event);
}
```

`resolveConfig` defaults `events` to a new `InMemoryEventBus` when none is supplied.

**Domain events.** Every event extends `DomainEvent` (`src/domain/events/domain-event.ts`) and
carries `name`, `payload`, `correlationId`, and `occurredAt`. Event names are drawn from a fixed
`NormalizedEventName` union. The concrete events exported from `src/domain/events/index.ts`:

| Event class                     | Normalized name              |
| ------------------------------- | ---------------------------- |
| `CustomerCreatedEvent`          | `customer.created`           |
| `CheckoutCreatedEvent`          | `checkout.completed`         |
| `PaymentSucceededEvent`         | `payment.succeeded`          |
| `PaymentFailedEvent`            | `payment.failed`             |
| `SubscriptionCreatedEvent`      | `subscription.created`       |
| `SubscriptionUpdatedEvent`      | `subscription.updated`       |
| `SubscriptionCancelledEvent`    | `subscription.cancelled`     |
| `SubscriptionResumedEvent`      | `subscription.resumed`       |
| `InvoiceCreatedEvent`           | `invoice.created`            |
| `InvoicePaidEvent`              | `invoice.paid`               |
| `InvoiceFailedEvent`            | `invoice.payment_failed`     |
| `RefundCreatedEvent`            | `refund.created`             |
| `WebhookReceivedEvent`          | `webhook.received`           |
| `WebhookProcessedEvent`         | `webhook.processed`          |

The full `NormalizedEventName` union also includes `customer.updated`, `refund.succeeded`, and
`refund.failed` as valid names. Events carry value objects intact - `InvoicePaidEvent`, for example,
holds a `Money` total rather than a primitive.

**Failure modes.** `emit` is sequential and `await`s each listener; a listener that throws rejects
the `emit` call. The in-memory bus is synchronous within the process and is not durable - for
cross-process, durable delivery use the outbox.

---

[Previous: Idempotency](14-idempotency.md) · [Index](../00-index.md) · [Next: Multi-Tenancy](16-multi-tenancy.md)
