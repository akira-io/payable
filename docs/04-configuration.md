# Configuration

All configuration is passed to `createPayable(config)`, which calls `resolveConfig(config)` to
produce a `ResolvedConfig`. This page documents every field of `PayableConfig`, the default
`resolveConfig` applies, and what each field unlocks.

## Validation and the provider registry

`resolveConfig` runs a `zod` schema over `tenant` and `idempotency` (it validates `tenant.enabled`
is a boolean and `idempotency.strategy` is `'auto' | 'manual'`). Payment providers are optional and
resolve to an empty registry when omitted:

```ts
const entries = Object.entries(config.providers ?? {});
```

## `PayableConfig` fields

### `tenant?: TenantConfig`

- **Type.** `{ enabled: boolean; resolver?: TenantResolver }`.
- **Required.** Optional.
- **Default.** When omitted, `tenantEnabled` resolves to `false` and `tenantResolver` is
  `undefined`.
- **Behavior.** When `enabled` is `true`, every fluent operation requires a tenant id;
  `Payable.customer(...)` throws `PayableError` code `TENANT_REQUIRED` if the tenant id is
  `undefined` or `null`. The optional `resolver` (a `TenantResolver`) derives a tenant id from an
  incoming webhook's provider, headers, and raw payload. See
  [features/16-multi-tenancy.md](features/16-multi-tenancy.md).

### `authorization?: AuthorizationConfig`

- **Type.** `{ enabled: boolean }`.
- **Required.** Optional.
- **Default.** `undefined`; resolves to `authorizationEnabled: false`.
- **Behavior.** When `enabled` is `true`, mutating actions enforce an `AuthorizationContext` through
  `assertAuthorized` and the policies in `src/application/policies/`. The context is supplied per
  call. When authorization is disabled, policy checks are skipped.

### `providers?: Record<string, PaymentProvider>`

- **Type.** Map of provider name to a `PaymentProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Stored as a `Map` and wrapped by `ProviderRegistry`. When no provider name is
  passed to a provider-bound operation, the first registered provider is used. When the registry is
  empty, provider-bound operations throw `ProviderNotFoundError` with code `PROVIDER_NOT_FOUND`
  before side effects. An explicit unknown provider name produces the same coded error. Payable
  never installs or infers a mock provider. Webhook routing with more than one provider registered
  requires `/webhooks/:provider`; otherwise `Payable` throws `PayableError` code
  `WEBHOOK_PROVIDER_AMBIGUOUS`.

### Local and provider-bound dependencies

`LocalDependencies` contains storage, tenant context, clock, authorization state, idempotency,
audit, events, and logging. Canonical collection reads use this contract and do not select a
provider. `BillingDependencies` extends it with an explicitly resolved `provider` and
`providerName` for operations that call an external payment API.

Storage-only instances can list canonical customers, subscriptions, and payments, and retrieve a
stored local subscription. Customer synchronization, catalogue provider operations, checkout,
charges, refunds, billing portals, and payment webhooks remain provider-bound.

### `accountingProviders?: Record<string, AccountingProvider>`

- **Type.** Map of provider name to an `AccountingProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.accountingProviders()`.

### `identityProviders?: Record<string, IdentityProvider>`

- **Type.** Map of provider name to an `IdentityProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.identityProviders()`.

### `issuingProviders?: Record<string, IssuingProvider>`

- **Type.** Map of provider name to an `IssuingProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.issuingProviders()`.

### `marketplaceProviders?: Record<string, MarketplaceProvider>`

- **Type.** Map of provider name to a `MarketplaceProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.marketplaceProviders()`.

### `taxProviders?: Record<string, TaxProvider>`

- **Type.** Map of provider name to a `TaxProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.taxProviders()`.

### `terminalProviders?: Record<string, TerminalProvider>`

- **Type.** Map of provider name to a `TerminalProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.terminalProviders()`.

### `treasuryProviders?: Record<string, TreasuryProvider>`

- **Type.** Map of provider name to a `TreasuryProvider` implementation.
- **Required.** Optional.
- **Default.** An empty map.
- **Behavior.** Each entry is registered by name and exposed through `Payable.treasuryProviders()`.

### `storage?: StorageDriver`

- **Type.** `StorageDriver` (a `Repositories` bundle plus a `transaction()` method).
- **Required.** Optional.
- **Default.** `undefined`.
- **Behavior.** Persists customers, products, prices, subscriptions, subscription items, invoices,
  payments, refunds, webhook events, audit logs, and the outbox. When omitted, the features that
  need it throw a `PayableError`: outbox (`OUTBOX_STORAGE_REQUIRED`), webhook processing
  (`WEBHOOK_STORAGE_REQUIRED`), and subscription management (`SUBSCRIPTION_STORAGE_REQUIRED`).
  Charges and refunds also require storage. The bundled implementation is `KnexStorageDriver`.

### `queue?: QueueDriver`

- **Type.** `QueueDriver` with `dispatch(job)` and `process(name, handler)`.
- **Required.** Optional.
- **Default.** `new SyncQueueDriver()`. The `Payable` constructor registers the webhook job handler
  via `queue.process(PROCESS_WEBHOOK_JOB, …)`.
- **Behavior.** Drives async webhook processing. `SyncQueueDriver` runs the handler inline on
  `dispatch`, so webhook processing happens synchronously in-process. Supplying `BullMQQueueDriver`
  moves processing onto a BullMQ queue/worker. See [persistence/22-queue.md](persistence/22-queue.md).

### `clock?: Clock`

- **Type.** `Clock` with `now(): Date`.
- **Required.** Optional.
- **Default.** `new SystemClock()` (`SystemClock.now()` returns `new Date()`).
- **Behavior.** All time reads go through the clock, so tests can inject `FakeClock`. Exposed via
  `Payable.clock()`.

### `logger?: Logger`

- **Type.** `Logger` with `debug`/`info`/`warn`/`error`.
- **Required.** Optional.
- **Default.** `new NullLogger()` (every method is a no-op).
- **Behavior.** With the default, nothing is logged. Supply `ConsoleLogger` or your own logger to
  capture output. Exposed via `Payable.logger()`.

### `events?: EventBus`

- **Type.** `EventBus` with `listen(name, listener)` and `emit(event)`.
- **Required.** Optional.
- **Default.** `new InMemoryEventBus()`.
- **Behavior.** Domain events (subscription/payment/invoice/webhook/etc.) are emitted through this
  bus. `InMemoryEventBus` dispatches to listeners registered by exact event name plus any `'*'`
  wildcard listeners, awaiting each in turn. Exposed via `Payable.events()`.

### `encryption?: Encryption`

- **Type.** `Encryption` with `encrypt(plaintext)` and `decrypt(ciphertext)`, both async.
- **Required.** Optional.
- **Default.** `undefined`.
- **Behavior.** Used to encrypt/decrypt sensitive stored values when supplied. The bundled
  implementation is `NodeEncryptionDriver`. See [28-security.md](28-security.md).

### `idempotency?: IdempotencyConfig`

- **Type.** `{ enabled?: boolean; strategy?: 'auto' | 'manual'; store?: IdempotencyStore }`.
- **Required.** Optional.
- **Default.** Resolved to `{ enabled: true, strategy: 'auto', store: undefined }`.
- **Behavior.** Controls idempotent execution of operations. Documented in detail below.

## `IdempotencyConfig`

| Field | Type | Default (after resolve) | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean?` | `true` | Whether idempotency is applied. On by default. |
| `strategy` | `'auto' \| 'manual'?` | `'auto'` | `auto` derives keys automatically; `manual` expects caller-provided keys. |
| `store` | `IdempotencyStore?` | `undefined` | Persists idempotency records (`find`/`acquire`/`takeOver`/`put`/`markCompleted`/`markFailed`). The bundled Knex-backed store is `KnexIdempotencyRepository`. |

There is **no** `resolver` field on `IdempotencyConfig`. Key derivation is handled inside the
operations (via `IdempotencyKey.forCharge`/`forRefund`/etc.); the exported `DefaultIdempotencyKeyResolver`
and the `IdempotencyKeyResolver` contract belong to `ResolveIdempotencyKeyAction`. Operation authors
can pass entity or global resolvers through `ExecuteIdempotentOperationAction`; the action sends the
resolved string key to `IdempotencyService`. `IdempotencyStrategy` is available as a type. The
`IdempotencyStore` record status is one of `'processing' | 'completed' | 'failed' | 'expired'`. See
[features/14-idempotency.md](features/14-idempotency.md).

## `TenantConfig`

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `enabled` | `boolean` | Yes (when `tenant` is supplied) | Turns tenant scoping on. When on, a tenant id is mandatory for fluent operations. |
| `resolver` | `TenantResolver?` | No | Resolves a tenant id from a webhook's `{ provider, headers, payload }`. |

## Resolved-config reference

`resolveConfig` returns a `ResolvedConfig` with these fields. Note the shape differs from the input:
`providers` becomes a `Map`, `tenant` is flattened into `tenantEnabled` + `tenantResolver`, and
`queue`/`clock`/`logger`/`events`/`idempotency` are always present (defaulted).

| Resolved field | Source | Default applied |
| --- | --- | --- |
| `tenantEnabled` | `config.tenant?.enabled` | `false` |
| `tenantResolver` | `config.tenant?.resolver` | `undefined` |
| `authorizationEnabled` | `config.authorization?.enabled` | `false` |
| `providers` | `new Map(entries)` | empty `Map` |
| `accountingProviders` | `config.accountingProviders` | empty `Map` |
| `identityProviders` | `config.identityProviders` | empty `Map` |
| `issuingProviders` | `config.issuingProviders` | empty `Map` |
| `marketplaceProviders` | `config.marketplaceProviders` | empty `Map` |
| `taxProviders` | `config.taxProviders` | empty `Map` |
| `terminalProviders` | `config.terminalProviders` | empty `Map` |
| `treasuryProviders` | `config.treasuryProviders` | empty `Map` |
| `storage` | `config.storage` | `undefined` |
| `queue` | `config.queue` | `new SyncQueueDriver()` |
| `clock` | `config.clock` | `new SystemClock()` |
| `logger` | `config.logger` | `new NullLogger()` |
| `events` | `config.events` | `new InMemoryEventBus()` |
| `encryption` | `config.encryption` | `undefined` |
| `idempotency.enabled` | `config.idempotency?.enabled` | `true` |
| `idempotency.strategy` | `config.idempotency?.strategy` | `'auto'` |
| `idempotency.store` | `config.idempotency?.store` | `undefined` |

## Cache and lock utilities

`cache` and `locks` are not `PayableConfig` keys. `resolveConfig` rejects either key with
`CONFIG_OPTION_UNSUPPORTED`. `CacheDriver`, `LockDriver`, `MemoryCacheDriver`, and
`MemoryLockDriver` remain available for direct composition outside `createPayable`. Internal Redis
scaffolds are not supported configuration and must not be deep-imported.

---

[Previous: Getting Started](03-getting-started.md) · [Index](00-index.md) · [Next: Domain Model](domain/05-domain-model.md)
