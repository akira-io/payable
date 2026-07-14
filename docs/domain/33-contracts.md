# Contracts

Contracts live in `src/domain/contracts/` (re-exported from `index.ts`, plus the separately-exported `tenant-resolver.contract.ts`). They are the **dependency-inversion seams** of the engine: the domain layer defines these interfaces, and the infrastructure layer implements them. The dependency rule always points inward - infrastructure depends on the domain contracts, never the reverse - so storage, queue, cache, provider, and cross-cutting concerns are pluggable without the domain knowing the concrete type.

Most repository methods are **tenant-scoped**: they take an optional trailing `tenantId?: string | null` (or, on write shapes, a `tenantId` field). `null` means "not bound to a tenant"; omitting it falls through to the driver's default scoping. See [Multi-tenancy](../features/16-multi-tenancy.md).

## Repositories

Repositories persist and read the [entities](05-domain-model.md). Each defines a `New<Entity>` write shape (an `Omit` of generated fields like `id`, `createdAt`, `updatedAt`) and tenant-scoped reads. They are grouped behind the `Repositories` interface and exposed transactionally by `StorageDriver` (see Drivers). In this repo every repository is implemented by the Knex driver classes in `src/infrastructure/storage/knex/repositories/` (`KnexCustomerRepository`, `KnexSubscriptionRepository`, and so on).

| Contract | Key methods | Notes |
| --- | --- | --- |
| `CustomerRepository` | `create`, `update`, `findById`, `findByBillable`, `findByProviderId` | Look up by `(billableType, billableId)` or by `(provider, providerCustomerId)`. |
| `SubscriptionRepository` | `create`, `update`, `findById`, `findByName`, `findByProviderId`, `listByCustomer`, `list` | List methods accept `ListOptions` (cursor pagination). |
| `SubscriptionItemRepository` | `create`, `createMany`, `updatePrimary`, `listBySubscription` | `updatePrimary` patches the primary line via `SubscriptionItemPatch`. |
| `PaymentRepository` | `create`, `update`, `findById`, `findByIdForUpdate`, `findByProviderId`, `listByCustomer`, `list` | `findByIdForUpdate` takes a row lock for safe concurrent refund accounting. |
| `RefundRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByPayment` | Scoped to a payment via `listByPayment`. |
| `InvoiceRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByCustomer` | |
| `ProductRepository` | `create`, `update`, `findById`, `findByProviderId` | `findById` is not tenant-scoped. |
| `PriceRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByProduct` | `findById` is not tenant-scoped. |
| `WebhookEventRepository` | `create`, `list`, `findById`, `findByProviderEvent`, `claim`, `markStatus` | `claim` returns a claim token for exactly-once processing; `findByProviderEvent` backs idempotent receipt. |
| `WebhookEndpointRepository` | `create`, `findById`, `list`, `listEnabledForEvent`, `setStatus` | `listEnabledForEvent` resolves delivery targets for a normalized event type. |
| `WebhookDeliveryRepository` | `record`, `listForEvent` | Append-only delivery log. |
| `AuditLogRepository` | `create`, `list`, `verifyChain`, `backfillChain` | Hash-chained; `verifyChain`/`backfillChain` operate per tenant. See [Reliability](../features/15-reliability.md). |
| `OutboxEventRepository` | `create`, `claimPending`, `markPublished`, `markFailed` | Backs the transactional outbox; `claimPending(limit)` leases rows for the relay. |

```ts
export interface CustomerRepository {
  create(data: NewCustomer): Promise<Customer>;
  update(id: string, patch: Partial<NewCustomer>, tenantId?: string | null): Promise<Customer>;
  findById(id: string, tenantId?: string | null): Promise<Customer | null>;
  findByBillable(
    billableType: string,
    billableId: string,
    tenantId?: string | null,
  ): Promise<Customer | null>;
  findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId?: string | null,
  ): Promise<Customer | null>;
}
```

### ListOptions

`src/domain/contracts/list-options.contract.ts`. Cursor pagination shared by the `list*` repository methods.

```ts
export interface ListCursor {
  createdAt: Date;
  id: string;
}

export interface ListOptions {
  limit?: number;
  before?: ListCursor;
}
```

## Drivers

Drivers are the infrastructure backends the engine runs on. Each has at least one in-process implementation and one external implementation, so the same engine code runs against memory or a real backend.

| Contract | Key methods | Implementations in this repo |
| --- | --- | --- |
| `StorageDriver` (extends `Repositories`) | `transaction<T>(work: (repos) => Promise<T>)` plus all repository accessors | `KnexStorageDriver` |
| `QueueDriver` | `dispatch<T>(job)`, `process<T>(name, handler)` | `SyncQueueDriver`, `BullMQQueueDriver` |
| `CacheDriver` | `get`, `set`, `delete`, `has` | `MemoryCacheDriver`, `RedisCacheDriver` |
| `LockDriver` | `acquire(key, ttlMs)`, `withLock(key, ttlMs, work)` | `MemoryLockDriver`, `RedisLockDriver` |
| `Encryption` | `encrypt(plaintext)`, `decrypt(ciphertext)` | `NodeEncryptionDriver` |

`StorageDriver` exposes the full `Repositories` bag both directly and inside `transaction`, so a unit of work commits or rolls back atomically:

```ts
export interface StorageDriver extends Repositories {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

```ts
export interface QueueDriver {
  dispatch<T>(job: QueueJob<T>): Promise<void>;
  process<T>(name: string, handler: JobHandler<T>): void;
}
```

## Provider and cross-cutting seams

### PaymentProvider

`src/domain/contracts/payment-provider.contract.ts`. The provider abstraction. The **base** interface is intentionally small - every provider must expose `name`, `capabilities()`, `createCheckoutSession`, and `refund`. Everything else is an **optional capability interface** that a provider opts into. A `is*Capable(provider)` type guard accompanies each one, so callers narrow at runtime before invoking an optional method (and raise `ProviderCapabilityNotSupportedError` otherwise).

```ts
export interface PaymentProvider {
  readonly name: string;
  capabilities(): ProviderCapabilities;
  createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO>;
  refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO>;
}
```

| Capability interface | Methods | Guard |
| --- | --- | --- |
| `CustomerCapable` | `createCustomer`, `updateCustomer` | `isCustomerCapable` |
| `CatalogCapable` | `createProduct`, `updateProduct`, `createPrice` | `isCatalogCapable` |
| `SubscriptionManagementCapable` | `updateSubscription`, `cancelSubscription`, `resumeSubscription` | `isSubscriptionManagementCapable` |
| `DirectSubscriptionCapable` | `createSubscription` | `isDirectSubscriptionCapable` |
| `ChargeCapable` | `charge` | `isChargeCapable` |
| `InvoiceCapable` | `listInvoices`, `downloadInvoicePdf` | `isInvoiceCapable` |
| `BillingPortalCapable` | `billingPortal` | `isBillingPortalCapable` |
| `PaymentMethodSetupCapable` | `createPaymentMethodSetup`, `retrievePaymentMethodSetup`, `cancelPaymentMethodSetup` | `isPaymentMethodSetupCapable` |
| `WebhookCapable` | `verifyWebhook`, `reconcileSubscription` | `isWebhookCapable` |
| `PaymentWebhookCapable` | `reconcilePayment` | `isPaymentWebhookCapable` |
| `RedirectCallbackCapable` | `verifyCallback`, `handleRedirectCallback` | `isRedirectCallbackCapable` |

Implementations: `StripeProvider` (charge, direct subscription, invoice, and more), `PaddleProvider`, and `SispProvider` (redirect-callback based). See [Providers](../integrations/17-providers.md) for the capability matrix.

`PaymentMethodSetupCapable` models saving a payment method without charging it. Its normalized DTO
supports provider flows that return a client secret, a hosted checkout URL, or a saved payment method
ID. It remains optional, and a provider advertises `paymentMethodSetup` only after implementing all
three lifecycle methods.

### TaxProvider

`src/domain/contracts/tax-provider.contract.ts`. Tax providers use a registry independent from payment
and Treasury providers. The base contract exposes only `name` and `capabilities()`.

| Capability interface | Methods | Guard |
| --- | --- | --- |
| `TaxCalculationCapable` | `calculateTax`, `retrieveTaxCalculation` | `isTaxCalculationCapable` |
| `TaxTransactionCapable` | `commitTaxTransaction`, `reverseTaxTransaction` | `isTaxTransactionCapable` |

Tax DTOs use `Money` for every amount and do not expose vendor SDK types. Applications select an
adapter through `payable.taxProviders()` and narrow it with the matching guard.

### IssuingProvider

Issuing providers have an independent registry and optional contracts for cardholders, cards,
authorizations, and issuing transactions. Card DTOs expose only last four, expiry, brand, status, and
provider identifiers. PAN, CVV, PIN, and track data are outside the domain contract.

### EventBus

`src/domain/contracts/event-bus.contract.ts`. The publish/subscribe seam for [domain events](34-domain-events.md).

```ts
export interface EventBus {
  listen(name: string, listener: EventListener): Unsubscribe;
  emit(event: DomainEvent): Promise<void>;
}
```

Implementation: `InMemoryEventBus` (the default).

### Clock

`src/domain/contracts/clock.contract.ts`. A single `now(): Date`, so time is injectable and testable.

Implementations: `SystemClock` (wall clock), `FakeClock` (test).

### Logger

`src/domain/contracts/logger.contract.ts`. Levelled structured logging: `debug`, `info`, `warn`, `error`, each `(message, context?)`.

Implementations: `ConsoleLogger`, `NullLogger`.

### TenantResolver

`src/domain/contracts/tenant-resolver.contract.ts`. Resolves the tenant for an inbound request (used by webhook receipt). Host-provided - there is no built-in implementation; it is supplied through `PayableConfig`.

```ts
export interface TenantResolver {
  resolve(context: TenantResolutionContext): string | null | Promise<string | null>;
}
```

### IdempotencyStore

`src/domain/contracts/idempotency-store.contract.ts`. Persists idempotency records and their lifecycle (`processing` / `completed` / `failed` / `expired`): `find`, `acquire`, `takeOver`, `put`, `markCompleted`, `markFailed`, each tenant-scoped. `markCompleted` and `markFailed` also accept optional `lockToken?` and `expiresAt?` params. See [Idempotency](../features/14-idempotency.md).

Implementation: `KnexIdempotencyRepository`.

### IdempotencyKeyResolver

`src/domain/contracts/idempotency-key-resolver.contract.ts`. Derives an idempotency key from an operation context: `resolve(context): string | null`.

Implementation: `DefaultIdempotencyKeyResolver`.

---

[Previous: State Machines](07-state-machines.md) · [Index](../00-index.md) · [Next: Domain Events](34-domain-events.md)
