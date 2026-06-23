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
  resolver?: IdempotencyKeyResolver;
  store?: IdempotencyStore;
}
```

Resolution defaults (`resolveConfig`):

- `enabled` defaults to **`true`**.
- `strategy` defaults to **`auto`**.

### auto vs manual

- **`auto`** - Payable derives the idempotency key itself from the operation context (provider,
  operation, resource type/id) using the resolver chain below. The caller does not have to supply a
  key.
- **`manual`** - the caller is expected to supply an explicit key. Key resolution is the same
  machinery; in `manual` mode the explicit key is the intended source rather than the derived
  fallback.

In both strategies the actual key is produced by `ResolveIdempotencyKeyAction`, which always has a
deterministic fallback, so a missing explicit key never crashes.

## Key resolution

`ResolveIdempotencyKeyAction` (`src/application/actions/idempotency/resolve-idempotency-key.action.ts`)
applies a fixed precedence:

```ts
const resolved =
  input.explicitKey ??
  input.entityResolver?.resolve(input.context) ??
  input.globalResolver?.resolve(input.context) ??
  this.fallback.resolve(input.context);
return IdempotencyKey.of(resolved);
```

1. **Explicit key** - a key passed directly by the caller.
2. **Entity resolver** - a per-entity `IdempotencyKeyResolver`.
3. **Global resolver** - the resolver from config (`idempotency.resolver`).
4. **Default resolver** - `DefaultIdempotencyKeyResolver`, always present.

A resolver may return `null`, in which case the chain falls through to the next source. The
`IdempotencyKeyResolverContext` carries `operation`, optional `provider`, optional `resourceType`,
and optional `resourceId`.

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
  markCompleted(key, response, tenantId?): Promise<void>;
  markFailed(key, tenantId?): Promise<void>;
}
```

A record has `status` of `processing | completed | failed | expired`, the `requestHash`, the cached
`response`, a `lockedUntil` lock expiry, and an optional `expiresAt`.

## Execution flow

`IdempotencyService` (`src/application/services/idempotency/idempotency-service.ts`) ties it
together. Options: `lockTtlMs` (default `30_000`) and `retryFailed` (default `true`).

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
if (existing.requestHash !== requestHash) throw new IdempotencyConflictError(key);
if (existing.status === 'completed') return { handled: true, value: existing.response as T };
if (existing.status === 'processing' && this.isLocked(existing)) throw new IdempotencyInProgressError(key);
if (existing.status === 'failed' && !this.retryFailed) throw new IdempotencyConflictError(key);
return { handled: false };
```

- **Different request hash** → `IdempotencyConflictError`. This is the "same key, different body"
  guard, and it is checked **before** anything else - even an `expired` record cannot bypass the
  hash check.
- **Completed** → the cached `response` is replayed; the operation does **not** run again.
- **Processing and still locked** → `IdempotencyInProgressError`. A concurrent run holds the lock.
- **Failed with `retryFailed: false`** → `IdempotencyConflictError`.
- Otherwise (no record, failed with retry allowed, processing with an expired lock) → fall through
  and run.

`isLocked` compares `lockedUntil` against the clock; once `lockedUntil` has passed, a `processing`
record no longer blocks and the operation may be re-attempted.

### run - acquiring the lock and executing

```ts
const record = this.processingRecord(execution, requestHash);
const acquired = await this.store.acquire(record, execution.tenantId);
if (!acquired) {
  const existing = await this.store.find(execution.key, execution.tenantId);
  const replay = this.replay<T>(existing, requestHash, execution.key);
  if (replay.handled) return replay.value as T;
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
- If acquisition fails, the service re-checks: the winner may already have completed (replay), or
  its lock may have expired, in which case `takeOver` claims the stale lock. If neither, the caller
  gets `IdempotencyInProgressError`.
- On success the record is marked `completed` with the response cached. On failure it is marked
  `failed` and the original error is rethrown - so with `retryFailed: true` (default) a later retry
  re-runs the operation.

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
| Expired record, different request body            | Still `IdempotencyConflictError` - hash check first  |
| Concurrent run, lock still held                   | `IdempotencyInProgressError`                         |
| Concurrent acquire, two callers                   | One wins via `acquire`; loser replays or takes over  |
| Lock expired (`lockedUntil` passed)               | Stale lock; `takeOver` reclaims and runs             |
| Operation throws                                  | Record marked `failed`; error rethrown               |
| Failed record, `retryFailed: true` (default)      | Re-runs on the next attempt                          |
| Failed record, `retryFailed: false`               | `IdempotencyConflictError`                           |
| Empty key                                         | `IdempotencyKey.of('')` throws `TypeError`           |

---

[Previous: Webhooks](13-webhooks.md) · [Index](../00-index.md) · [Next: Reliability](15-reliability.md)
