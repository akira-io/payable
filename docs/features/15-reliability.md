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
  pullPending(limit: number): Promise<OutboxEvent[]>;
  claimPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, nextRetryAt: Date | null): Promise<void>;
}
```

An `OutboxEvent` carries `tenantId`, `correlationId`, `eventType`, `eventVersion`, `payload`,
`status` (`pending | processing | published | failed`), `attempts`, and `nextRetryAt`.

**Behavior.** `publishPending` claims a batch and delivers each one:

```ts
async publishPending(deliver: OutboxDelivery, limit = 50): Promise<OutboxPublishResult> {
  const events = await this.repository.claimPending(limit);
  const result = { published: 0, retried: 0, deadLettered: 0 };
  for (const event of events) await this.publishOne(event, deliver, result);
  return result;
}
```

- `claimPending` claims rows for the worker - the Knex repository uses `forUpdate().skipLocked()`
  and flips them to `processing`, so concurrent workers never grab the same row.
- On successful delivery the row is `markPublished`.
- On failure, attempts are incremented. If `attempts >= maxAttempts` (default `5`) the row is
  dead-lettered via `markFailed(id, null)`. Otherwise it is scheduled for retry with exponential
  backoff: `nextRetry = now + backoffMs * 2 ** (attempts - 1)` (default `backoffMs` `1000`).

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

**Contract.** `AuditLogRepository` (`src/domain/contracts/audit-log-repository.contract.ts`)
exposes `create` and a filtered `list`. An `AuditLog`
(`src/domain/entities/audit-log.entity.ts`) carries `correlationId`, `actorType`, `actorId`,
`action`, `resourceType`, `resourceId`, `before`, `after`, `metadata`, `ipAddress`, `userAgent`, and
`createdAt`. There is no `update` or `delete` on the contract - entries are immutable.

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

**Failure modes.** `record` resolves to the persisted entry or rejects if the repository write
fails; there is no swallow. Reads are filtered through `ListAuditLogsQuery`.

## Encryption at rest

`NodeEncryptionDriver` (`src/infrastructure/encryption/node-encryption-driver.ts`) encrypts
sensitive values before they hit storage. It implements the `Encryption` contract
(`src/domain/contracts/encryption.contract.ts`): `encrypt(plaintext)` and `decrypt(ciphertext)`.

**Algorithm.** AES-256-GCM with a random 12-byte IV per encryption. The configured key string is
hashed with SHA-256 to derive the 256-bit key. Ciphertext is serialized as
`base64(iv):base64(authTag):base64(ciphertext)`.

```ts
constructor(options: { key: string }) {
  if (options.key.trim().length === 0) {
    throw new PayableError('Encryption key must be a non-empty high-entropy secret', {
      code: 'ENCRYPTION_KEY_REQUIRED',
    });
  }
  this.key = createHash('sha256').update(options.key).digest();
}
```

**What it encrypts.** When an encryption driver is configured, the Knex webhook-event repository
(`src/infrastructure/storage/knex/repositories/knex-webhook-event.repository.ts`) seals the
`payload`, `data`, and `headers` columns on write and opens them on read. The columns then contain
ciphertext, not plaintext - the stored row does not contain the event id, email, or header secret.

**Failure modes.** An empty key throws `ENCRYPTION_KEY_REQUIRED` at construction. Malformed
ciphertext (missing IV/tag/data parts) throws `ENCRYPTION_INVALID_CIPHERTEXT` on decrypt. The GCM
auth tag is verified on decrypt, so tampered ciphertext fails.

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
