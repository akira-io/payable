# Idempotency

A retried request must not produce a second charge, a second subscription, or a second refund.
Payable guards mutating operations with an idempotency layer: it resolves a stable key for the
operation, hashes the request, and either replays the stored response, blocks a concurrent run, or
runs the operation once and caches the result. The same key reused with a *different* request body
is rejected as a conflict.

## Configuration

Idempotency is configured through `IdempotencyConfig` on `PayableConfig`
(`src/support/config/payable-config.ts`):

```ts
export type IdempotencyStrategy = 'auto' | 'manual';

export interface IdempotencyConfig {
  enabled?: boolean;
  strategy?: IdempotencyStrategy;
  store?: IdempotencyStore;
}
```

`enabled` defaults to `true` and `strategy` defaults to `auto`. A configured `store` supplies the
engine record used for request hashing, concurrency control, replay, and failure state.

### Configuration behavior

- `auto` wires the configured store into operations that derive their own keys. An explicit catalog
  key also uses that store.
- `manual` leaves existing non-catalog key handling manual. An explicit catalog key still uses the
  configured store.
- `enabled: false` prevents Payable from creating an engine idempotency service, even when a store
  is present. A keyed catalog mutation can then use provider-native protection only.

Catalog behavior depends on whether a caller key, an engine store, and provider-native catalog
idempotency are available. See [Catalog mutation idempotency](#catalog-mutation-idempotency).

## Non-catalog key resolution

Some non-catalog actions use `ResolveIdempotencyKeyAction` to select an explicit key, then an entity
resolver, then `DefaultIdempotencyKeyResolver`:

```ts
const resolved =
  input.explicitKey ??
  input.entityResolver?.resolve(input.context) ??
  input.globalResolver?.resolve(input.context) ??
  this.fallback.resolve(input.context);
return IdempotencyKey.of(resolved);
```

The configuration has no resolver field. Action callers may still supply `globalResolver`
programmatically. A resolver may return `null`, which falls through to the next source and then the
deterministic default.

### DefaultIdempotencyKeyResolver

`src/application/services/idempotency/default-idempotency-key-resolver.ts` builds a deterministic
colon-delimited key, filling absent parts with `na`:

```ts
resolve(context: IdempotencyKeyResolverContext): string {
  return ['op', context.operation, context.provider ?? 'na',
    context.resourceType ?? 'na', context.resourceId ?? 'na'].join(':');
}
```

So `{ operation: 'charge', provider: 'stripe', resourceType: 'User', resourceId: '1' }` yields
`op:charge:stripe:User:1`, and `{ operation: 'charge' }` yields `op:charge:na:na:na`.

### Typed operation keys

`IdempotencyKey` (`src/domain/value-objects/idempotency-key.ts`) also offers typed factories for the
core operations, each URL-encoding its segments:

- `forCheckout` → `checkout:<provider>:<billableType>:<billableId>:<price>:<subscriptionName>`
- `forCharge` → `charge:<provider>:<billableType>:<billableId>:<reference>:<amount>:<currency>`
- `forSubscription` → `subscription:<provider>:<billableType>:<billableId>:<subscriptionName>:<price>`
- `forRefund` → `refund:<provider>:<paymentId>:<amount>:<currency>`
- `forWebhook` → `webhook:<provider>:<providerEventId>`

`IdempotencyKey.of('')` throws - an empty key is never valid.

## Request hashing

The key answers *"is this the same logical operation?"*; the request hash answers *"is this the same
request body?"*. `hashRequest` (`src/support/hash/request-hash.ts`) canonicalizes the request before
digesting so that key order and `undefined` fields do not change the hash:

```ts
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}
```

The canonical string is SHA-256 hashed via `crypto.subtle.digest` and rendered as hex.

## The store

`IdempotencyStore` (`src/domain/contracts/idempotency-store.contract.ts`) persists one
`IdempotencyRecord` per key:

```ts
export interface IdempotencyStore {
  find(key, tenantId?): Promise<IdempotencyRecord | null>;
  acquire(record, tenantId?): Promise<boolean>;
  takeOver(record, tenantId?): Promise<boolean>;
  put(record, tenantId?): Promise<void>;
  markCompleted(key, response, tenantId?, lockToken?, expiresAt?): Promise<void>;
  markFailed(key, tenantId?, lockToken?, expiresAt?): Promise<void>;
}
```

A record has `status` of `processing | completed | failed | expired`, the `requestHash`, the cached
`response`, a `lockedUntil` lock expiry, and an optional `expiresAt`.

## Execution flow

`IdempotencyService` (`src/application/services/idempotency/idempotency-service.ts`) ties it
together. Service options: `lockTtlMs` (default `30_000`), `retryFailed` (default `true`),
`completedTtlMs` (default `86_400_000`), and `failedTtlMs` (default = `lockTtlMs`).

Every key is scope-isolated. Before touching the store the service wraps the key as
`${scope}:${key}` via `scopedKey()`, and `find`, `acquire`, `markCompleted`, and `markFailed` all
operate on that scoped key. Two operations that resolve to the same raw key under different scopes
never collide.

`completedTtlMs` and `failedTtlMs` drive the `expiresAt` TTLs stamped on the stored record: a
completed record's `expiresAt` is `now + completedTtlMs`, a failed record's is `now + failedTtlMs`.
Once `expiresAt` passes the record reports the `expired` status path and no longer replays.

`lockTtlMs` is the window before a held lock is considered stale. Set it comfortably above the
slowest provider call so a long-running operation never lapses while in flight — a lapsed lock now
fails closed (see above) rather than re-running. Any single execution can override the service
default per operation with `lockTtlMs` on the `IdempotentExecution`, so a slow charge can claim a
longer lock than a fast lookup without widening the window for everything. `retryFailed` is
likewise overridable per execution (`execution.retryFailed ?? service default`), so one operation
can opt out of retrying a failed record without changing the service-wide default.

```ts
async execute<T>(execution: IdempotentExecution<T>): Promise<T> {
  const requestHash = await hashRequest(execution.request);
  const existing = await this.store.find(execution.key, execution.tenantId);
  const replay = this.replay<T>(existing, requestHash, execution.key);
  if (replay.handled) return replay.value as T;
  return this.run(execution, requestHash);
}
```

### replay - what an existing record does

```ts
if (!existing) return { handled: false };
if (this.isExpired(existing)) return { handled: false };
if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(key);
if (existing.status === 'completed') return { handled: true, value: existing.response as T };
if (existing.status === 'processing' && this.isLocked(existing)) throw new IdempotencyInProgressError(key);
if (existing.status === 'failed' && !retryFailed) throw new IdempotencyConflictError(key);
return { handled: false };
```

- **Expired record** → falls through and re-runs. The `isExpired` check comes **first**, before the
  hash comparison, so an expired record bypasses the conflict guard entirely: a retry with a
  *different* body does **not** throw, it re-runs the operation under the new request.
- **Different request hash** → `IdempotencyConflictError`. This is the "same key, different body"
  guard, checked for any non-expired record before status is considered.
- **Completed** → the cached `response` is replayed; the operation does **not** run again.
- **Processing and still locked** → `IdempotencyInProgressError`. A concurrent run holds the lock.
- **Failed with `retryFailed: false`** → `IdempotencyConflictError`.
- Otherwise (no record, failed with retry allowed) → fall through and run.

`isLocked` compares `lockedUntil` against the clock. A `processing` record whose `lockedUntil` has
passed is **stale**: the original holder either crashed mid-flight (its side effect may already have
committed) or is still running past the lock TTL. The service does **not** blindly re-run it. By
default a stale `processing` record fails closed with `IdempotencyInProgressError`, so a money-moving
operation is never silently executed twice. Set `reclaimStaleProcessing: true` on the execution to
opt in to reclaiming and re-running a stale lock when the operation is known safe to repeat.

### run - acquiring the lock and executing

```ts
const record = this.processingRecord(execution, requestHash);
const acquired = await this.store.acquire(record, execution.tenantId);
if (!acquired) {
  const existing = await this.store.find(execution.key, execution.tenantId);
  const replay = this.replay<T>(existing, requestHash, execution.key);
  if (replay.handled) return replay.value as T;
  if (existing?.status === 'processing' && !execution.reclaimStaleProcessing) {
    throw new IdempotencyInProgressError(execution.key);
  }
  const claimed = await this.store.takeOver(record, execution.tenantId);
  if (!claimed) throw new IdempotencyInProgressError(execution.key);
}
try {
  const result = await execution.run();
  await this.store.markCompleted(execution.key, result, execution.tenantId);
  return result;
} catch (error) {
  await this.store.markFailed(execution.key, execution.tenantId);
  throw error;
}
```

- `acquire` atomically inserts the `processing` record with `lockedUntil = now + lockTtlMs`. Only
  one acquirer wins, even with a null tenant.
- If acquisition fails, the service re-checks: the winner may already have completed (replay). A
  stale `processing` record (expired lock) fails closed with `IdempotencyInProgressError` unless
  `reclaimStaleProcessing` is set; a `failed`-with-retry or expired record is reclaimed via
  `takeOver`. If `takeOver` claims nothing, the caller gets `IdempotencyInProgressError`.
- On success the record is marked `completed` with the response cached. On failure it is marked
  `failed` and the original error is rethrown - so with `retryFailed: true` (default) a later retry
  re-runs the operation.

## Catalog mutation idempotency

Product and price writes accept `CatalogMutationOptions`:

```ts
interface CatalogMutationOptions {
  authorization?: AuthorizationContext;
  idempotencyKey?: string;
}

await payable.products('stripe-primary', 'tenant-acme').create(
  { name: 'Pro' },
  { idempotencyKey: 'catalog-product-pro-v1' },
);
```

The option applies to product create, update, activate, and archive operations, and to price create,
activate, and archive operations. A caller key must contain 1 through 255 Unicode scalar values. It
cannot be blank, start or end with whitespace, or contain an unpaired surrogate. Treat it as opaque
and avoid customer identifiers or other sensitive data.

Omitting the key preserves provider and persistence behavior without catalog idempotency. Reuse the
same key only to retry the same request. The engine rejects the same key with a different request as
`IDEMPOTENCY_CONFLICT`. A new key represents a new intentional operation.

### Effective identity and provider key

The effective identity combines four dimensions: tenant scope, registered provider, catalog
operation, and caller key. The same caller key can therefore identify independent operations across
tenants, provider registrations, or actions such as `product.create` and `product.update`.

For a provider that declares `catalogIdempotency`, Payable derives this provider-safe key:

```text
payable:catalog:v1:<lowercase SHA-256 hex digest>
```

The digest covers the version tag, tagged tenant scope, registered provider, catalog operation, and
caller key. The raw caller key is never forwarded to the provider. This prevents one tenant,
provider registration, or operation from sharing the provider key of another.

### Execution matrix

| Caller key | Engine store | Provider capability | Behavior |
| --- | --- | --- | --- |
| absent | any | any | Run without catalog idempotency. |
| present | configured | `catalogIdempotency` | Deduplicate in the engine and send the derived key to the provider. |
| present | configured | absent | Deduplicate in the engine and require reconciliation after an ambiguous failure. |
| present | unavailable | `catalogIdempotency` | Send only the derived provider key. |
| present | unavailable | absent | Fail before the provider with `CATALOG_IDEMPOTENCY_STORAGE_REQUIRED`. |

The engine marks a catalog operation complete only after the provider mutation and durable local
catalog persistence both succeed. If it cannot verify the completed record, it returns
`IDEMPOTENCY_RESULT_PERSISTENCE_FAILED`. Authorization and capability checks run before any stored
response can be replayed.

For a provider without native catalog idempotency, an ambiguous mutation failure marks the operation
for reconciliation. A retry with the same key returns `IDEMPOTENCY_RECONCILIATION_REQUIRED` instead
of calling the provider again. List or retrieve the catalog entity, determine whether the first
request succeeded, repair local state when required, then use a new key only for a new intentional
operation.

Idempotency is not a distributed transaction. It reduces duplicate execution, but it cannot make a
remote provider mutation and local database commit atomic. Preserve correlation IDs and reconcile
remote and local state whenever an outcome is uncertain.

## Wiring an operation through it

`ExecuteIdempotentOperationAction`
(`src/application/actions/idempotency/execute-idempotent-operation.action.ts`) resolves the key and
delegates to the service:

```ts
const key = this.resolver.handle({
  explicitKey: input.explicitKey,
  context: input.context,
  entityResolver: input.entityResolver,
  globalResolver: input.globalResolver,
});
return this.service.execute({
  key: key.toString(),
  scope: input.scope,
  operation: input.context.operation,
  request: input.request,
  resourceType: input.context.resourceType ?? null,
  resourceId: input.context.resourceId ?? null,
  tenantId: input.tenantId,
  run: input.run,
});
```

## Example

The operation runs once and the second call replays the cached response:

```ts
const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
let runs = 0;
const request = { amount: 9900, currency: 'USD' };
const run = async () => { runs += 1; return { paymentId: 'pay_1' }; };

const first = await service.execute({ key: 'charge:1', scope: 'charge', operation: 'charge', request, run });
const second = await service.execute({ key: 'charge:1', scope: 'charge', operation: 'charge', request, run });

// first === second === { paymentId: 'pay_1' }, runs === 1
```

Reusing `charge:2` with a different body throws `IdempotencyConflictError`.

## Edge cases

| Scenario                                          | Outcome                                              |
| ------------------------------------------------- | ---------------------------------------------------- |
| Same key, same request, after completion          | Cached response replayed; `run` not called again     |
| Same key, different request body                  | `IdempotencyConflictError` (checked before status)   |
| Expired record, different request body            | Falls through and re-runs - expiry checked before hash |
| Concurrent run, lock still held                   | `IdempotencyInProgressError`                         |
| Concurrent acquire, two callers                   | One wins via `acquire`; loser replays or takes over  |
| Stale `processing` lock (`lockedUntil` passed)    | Fails closed `IdempotencyInProgressError` by default |
| Stale lock with `reclaimStaleProcessing: true`    | `takeOver` reclaims the stale lock and re-runs        |
| Operation throws                                  | Record marked `failed`; error rethrown               |
| Failed record, `retryFailed: true` (default)      | Re-runs on the next attempt                          |
| Failed record, `retryFailed: false`               | `IdempotencyConflictError`                           |
| Empty key                                         | `IdempotencyKey.of('')` throws `TypeError`           |

---

[Previous: Webhooks](13-webhooks.md) · [Index](../00-index.md) · [Next: Reliability](15-reliability.md)
