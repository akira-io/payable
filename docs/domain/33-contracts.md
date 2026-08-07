# Contracts

Contracts live in `src/domain/contracts/` (re-exported from `index.ts`, plus the separately-exported `tenant-resolver.contract.ts`). They are the **dependency-inversion seams** of the engine: the domain layer defines these interfaces, and the infrastructure layer implements them. The dependency rule always points inward - infrastructure depends on the domain contracts, never the reverse - so storage, queue, cache, provider, and cross-cutting concerns are pluggable without the domain knowing the concrete type.

Most repository methods are **tenant-scoped**: they take a trailing `tenantId` argument or a `tenantId` write field. `null` selects the tenantless partition. Catalog repository reads require an explicit tenant argument; omitting it is not accepted. See [Multi-tenancy](../features/16-multi-tenancy.md).

## Repositories

Repositories persist and read the [entities](05-domain-model.md). Each defines a `New<Entity>` write shape (an `Omit` of generated fields like `id`, `createdAt`, `updatedAt`) and tenant-scoped reads. They are grouped behind the `Repositories` interface and exposed transactionally by `StorageDriver` (see Drivers). In this repo every repository is implemented by the Knex driver classes in `src/infrastructure/storage/knex/repositories/` (`KnexCustomerRepository`, `KnexSubscriptionRepository`, and so on).

| Contract | Key methods | Notes |
| --- | --- | --- |
| `CustomerRepository` | `create`, `update`, `findById`, `findByBillable`, `list` | Persists provider-neutral customers and supports tenant-scoped logical collection queries. |
| `CustomerProviderBindingRepository` | `create`, `findByCustomerAndProvider`, `findByProviderId`, `listByCustomerIds` | Maps a logical customer to each registered provider account; every lookup is tenant-scoped through the owning customer. |
| `SubscriptionRepository` | `create`, `update`, `findById`, `findByName`, `findByProviderId`, `listByCustomer`, `list` | List methods accept `ListOptions` (cursor pagination). |
| `SubscriptionItemRepository` | `create`, `createMany`, `updatePrimary`, `listBySubscription` | `updatePrimary` patches the primary line via `SubscriptionItemPatch`. |
| `PaymentRepository` | `create`, `update`, `findById`, `findByIdForUpdate`, `findByProviderId`, `listByCustomer`, `list` | `findByIdForUpdate` takes a row lock for safe concurrent refund accounting. |
| `RefundRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByPayment` | Scoped to a payment via `listByPayment`. |
| `InvoiceRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByCustomer` | |
| `ProductRepository` | `create`, `update`, `findById`, `findByProviderId` | Reads and updates require an explicit tenant partition. |
| `PriceRepository` | `create`, `update`, `findById`, `findByProviderId`, `listByProduct` | Reads and updates require an explicit tenant partition. |
| `WebhookEventRepository` | `create`, `list`, `findById`, `findByProviderEvent`, `claim`, `markStatus` | `claim` returns a claim token for exactly-once processing; `findByProviderEvent` backs idempotent receipt. |
| `WebhookEndpointRepository` | `create`, `findById`, `list`, `listEnabledForEvent`, `setStatus` | `listEnabledForEvent` resolves delivery targets for a normalized event type. |
| `WebhookDeliveryRepository` | `record`, `listForEvent` | Append-only delivery log. |
| `AuditLogRepository` | `create`, `list`, `verifyChain`, `backfillChain` | Hash-chained; `verifyChain`/`backfillChain` operate per tenant. See [Reliability](../features/15-reliability.md). |
| `OutboxEventRepository` | `create`, `claimPending`, `markPublished`, `markFailed` | Backs the transactional outbox; `claimPending(limit)` leases rows for the relay. |

### Audit resource and repository

`AuditLogRepository` is the storage seam; `AuditResource` is the application-facing API. The
resource binds a trusted tenant, validates custom domain entries, returns cursor pages, and delegates
hash-chain verification to the repository.

```ts
export interface AuditLogQuery {
  tenantId?: string | null;
  actions?: readonly string[];
  resourceTypes?: readonly string[];
  resourceIds?: readonly string[];
  correlationIds?: readonly string[];
  actorTypes?: readonly string[];
  actorIds?: readonly string[];
  createdAfter?: Date;
  createdBefore?: Date;
  beforeSequence?: number;
  limit?: number;
}

export interface AuditLogRepository {
  create(data: NewAuditLog): Promise<AuditLog>;
  list(query: AuditLogQuery): Promise<AuditLog[]>;
  verifyChain(tenantId: string | null): Promise<boolean>;
  backfillChain(tenantId: string | null): Promise<number>;
}
```

Fields within one plural filter use OR semantics; separate filter dimensions use AND semantics.
Repositories order by the immutable tenant sequence descending. `AuditResource` converts that
sequence into an opaque cursor and returns `{ data, nextCursor }`.

Applications may construct `new AuditResource(repositories.auditLogs, tenantId)` inside a storage
transaction. For transactions that also modify host-owned tables, use the exported
`KnexAuditLogRepository` or `PrismaAuditLogRepository` over the host transaction. See
[Custom domain audit](../examples/46-custom-domain-audit.md).

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
  list?(
    query: CustomerListQuery,
    tenantId: string | null,
  ): Promise<CustomerListResult>;
}

export interface CustomerProviderBindingRepository {
  create(data: NewCustomerProviderBinding): Promise<CustomerProviderBinding>;
  findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null>;
  findByProviderId(
    provider: string,
    providerCustomerId: string,
    tenantId: string | null,
  ): Promise<CustomerProviderBinding | null>;
  listByCustomerIds?(
    customerIds: readonly string[],
    tenantId: string | null,
  ): Promise<CustomerProviderBinding[]>;
}
```

`CustomerListQuery` combines exact `id`, `billableType`, and `billableId` filters with
case-insensitive substring `email` and `name` filters. Its cursor is the exclusive
`(createdAt, id)` boundary decoded by `CustomerResource`. Repositories order both fields descending,
fetch one row beyond the bounded page, and return `{ items, hasMore }`. `CustomerResource` converts
that result to the provider-neutral `{ items, nextCursor, hasMore }` contract.

The list methods are optional so existing custom storage drivers remain source-compatible. The
bundled Knex and Prisma drivers implement both methods. Calling `CustomerResource.list()` against a
custom driver without collection support returns `CUSTOMER_LIST_UNSUPPORTED`; requesting bindings
without batch binding support returns `CUSTOMER_BINDING_LIST_UNSUPPORTED`.

### Catalog repositories

Products and prices are partitioned by tenant. Pass a tenant id for a tenant-owned catalog, or
`null` for the tenantless partition. Catalog creates require `tenantId` in their input and reject an
omitted value at runtime. An update cannot move a record between partitions because `ProductPatch`
and `PricePatch` exclude `tenantId` and the storage adapters discard tenant fields from runtime
patches.

```ts
export interface ProductRepository {
  create(data: NewProduct): Promise<Product>;
  update(id: string, patch: ProductPatch, tenantId: string | null): Promise<Product>;
  findById(id: string, tenantId: string | null): Promise<Product | null>;
  findByProviderId(provider: string, providerProductId: string, tenantId: string | null): Promise<Product | null>;
}

export interface PriceRepository {
  create(data: NewPrice): Promise<Price>;
  update(id: string, patch: PricePatch, tenantId: string | null): Promise<Price>;
  findById(id: string, tenantId: string | null): Promise<Price | null>;
  findByProviderId(provider: string, providerPriceId: string, tenantId: string | null): Promise<Price | null>;
  listByProduct(productId: string, tenantId: string | null): Promise<Price[]>;
}
```

```ts
const product = await storage.products.findById('product-id', 'tenant-a');
const tenantlessProduct = await storage.products.findById('product-id', null);
const prices = await storage.prices.listByProduct('product-id', 'tenant-a');
await storage.products.update('product-id', { name: 'Pro' }, 'tenant-a');
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

Drivers define infrastructure contracts. The engine consumes the storage, queue, and encryption
contracts. Cache and lock contracts remain available for direct composition outside the engine.

| Contract | Key methods | Implementations in this repo |
| --- | --- | --- |
| `StorageDriver` (extends `Repositories`) | `transaction<T>(work: (repos) => Promise<T>)` plus all repository accessors | `KnexStorageDriver` |
| `QueueDriver` | `dispatch<T>(job)`, `process<T>(name, handler)` | `SyncQueueDriver`, `BullMQQueueDriver` |
| `CacheDriver` | `get`, `set`, `delete`, `has` | `MemoryCacheDriver` (public, working); `RedisCacheDriver` (internal, unusable) |
| `LockDriver` | `acquire(key, ttlMs)`, `withLock(key, ttlMs, work)` | `MemoryLockDriver` (public, working); `RedisLockDriver` (internal, unusable) |
| `Encryption` | `encrypt(plaintext)`, `decrypt(ciphertext)` | `NodeEncryptionDriver` |

`MemoryCacheDriver` and `MemoryLockDriver` can be instantiated and used directly outside
`createPayable`. The Redis classes are internal scaffolds, not external backends available to the
engine. Each Redis constructor throws `NOT_IMPLEMENTED` before cache operations, `acquire`, or
`withLock` can run.

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
| `CatalogReadCapable` | `retrieveProduct`, `listProducts`, `retrievePrice`, `listPrices` | `isCatalogReadCapable` |
| `CatalogLifecycleCapable` | `setProductActive`, `setPriceActive` | `isCatalogLifecycleCapable` |
| `PriceLookupKeyCapable` | keyed `createPrice`, keyed `listPrices`, `transferPriceLookupKey` | `isPriceLookupKeyCapable` |
| `SubscriptionManagementCapable` | `updateSubscription`, `cancelSubscription`, `resumeSubscription` | `isSubscriptionManagementCapable` |
| `SubscriptionPauseCapable` | `pauseSubscription` | `isSubscriptionPauseCapable` |
| `PausedSubscriptionResumeCapable` | `resumePausedSubscription` | `isPausedSubscriptionResumeCapable` |
| `SubscriptionPaymentCollectionCapable` | `pausePaymentCollection`, `resumePaymentCollection` | `isSubscriptionPaymentCollectionCapable` |
| `ScheduledSubscriptionChangeCapable` | `cancelScheduledSubscriptionChange` | `isScheduledSubscriptionChangeCapable` |
| `DirectSubscriptionCapable` | `createSubscription` | `isDirectSubscriptionCapable` |
| `ChargeCapable` | `charge` | `isChargeCapable` |
| `InvoiceCapable` | `listInvoices`, `downloadInvoicePdf` | `isInvoiceCapable` |
| `BillingPortalCapable` | `billingPortal` | `isBillingPortalCapable` |
| `PaymentMethodSetupCapable` | `createPaymentMethodSetup`, `retrievePaymentMethodSetup`, `cancelPaymentMethodSetup` | `isPaymentMethodSetupCapable` |
| `WebhookCapable` | `verifyWebhook`, `reconcileSubscription` | `isWebhookCapable` |
| `PaymentWebhookCapable` | `reconcilePayment` | `isPaymentWebhookCapable` |
| `RedirectCallbackCapable` | `verifyCallback`, `handleRedirectCallback` | `isRedirectCallbackCapable` |

Implementations: `StripeProvider` (charge, direct subscription, invoice, and more), `PaddleProvider`, and `SispProvider` (redirect-callback based). See [Providers](../integrations/17-providers.md) for the capability matrix.

The lifecycle interfaces are intentionally narrow. A provider may implement lifecycle pause without
payment-collection pause, or the inverse. The serializable subscription-operation descriptor then
declares the precise timings, collection behaviors, scheduled-resume support, and resume billing
policies accepted by that implementation. Callers must check both the interface and the descriptor;
the application actions enforce both before invoking the provider.

### Catalog provider contracts

Catalog capabilities are split so a provider can expose only the operations it supports. Creation
and product metadata updates require `catalog`; retrieval and cursor pagination require
`catalogRead`; activation and archival require `catalogLifecycle`.

```ts
export interface CatalogCapable {
  createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO>;
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
}

export interface CatalogReadCapable {
  retrieveProduct(id: string): Promise<ProductDTO>;
  listProducts(input?: ListProductsInput): Promise<CatalogPage<ProductDTO>>;
  retrievePrice(id: string): Promise<PriceDTO>;
  listPrices(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>>;
}

export interface CatalogLifecycleCapable {
  setProductActive(id: string, active: boolean, ctx: OperationContext): Promise<ProductDTO>;
  setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO>;
}

export interface PriceLookupKeyCapable {
  createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO>;
  listPrices(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>>;
  transferPriceLookupKey(
    input: TransferPriceLookupKeyInput,
    ctx: OperationContext,
  ): Promise<PriceDTO>;
}
```

`ListProductsInput` accepts `limit`, `cursor`, and `active`. `ListPricesInput` adds an optional
`providerProductId` filter and, for providers with `priceLookupKeys`, a `lookupKeys` filter. Each
lookup key has a maximum of 200 Unicode code points, and a `lookupKeys` request accepts at most 10
keys. The resource layer defaults `limit` to 50 and `active` to `true`, rejects limits outside 1
through 100, and treats `CatalogPage.nextCursor` as an opaque provider cursor.

Payable rejects non-string, malformed Unicode, empty, whitespace-only, and over-limit lookup keys
with `PRICE_LOOKUP_KEY_INVALID`. It also rejects a `lookupKeys` value that is not an array or has more
than 10 items with the same error. After the capability gate, `list({ lookupKeys: [] })` returns an
empty page locally without calling the provider.

`PriceLookupKeyCapable` is optional. The resource checks the `priceLookupKeys` capability and
`isPriceLookupKeyCapable` before a create with `lookupKey` or `transferLookupKey: true`, a list with
`lookupKeys`, or `transferLookupKey(...)`. Ordinary catalog creates and lists remain available to
providers that do not support price lookup keys when these fields are absent.

`ProductDTO` contains provider identity, name, description, active state, and string metadata.
`PriceDTO` contains provider price and product identities, `Money`, optional recurring terms,
description, active state, and a provider-returned `lookupKey` when available. A lookup key is
provider-native routing metadata, not Payable price identity. Payable does not persist it as local
price identity. Price monetary terms have no update contract. Create a replacement price and archive
the old price when an amount, currency, interval, or interval count changes.

There is no portable delete contract for products or prices. Archival uses `setProductActive` or
`setPriceActive` with `false`; activation uses the same methods with `true`. Missing provider records
normalize to `PRODUCT_NOT_FOUND` or `PRICE_NOT_FOUND`.

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

Cardholder creation can carry a generic billing address and phone number. Card creation can carry a
currency, spending limit, and generic shipping contact. These inputs are optional at the domain
boundary because provider requirements differ; an adapter rejects a request before its remote call
when a provider-required field is absent.

### MarketplaceProvider

Marketplace providers coordinate seller accounts, onboarding, transfers, and payouts through an
independent registry. They identify recipients and move funds but do not process customer payments
automatically or add connected-account fields to payment DTOs.

### AccountingProvider

Accounting providers expose granular contracts for categories, bookkeeping tax-rate metadata, labels,
expenses, and ledger entries. These tax rates describe accounting records and do not satisfy
`TaxProvider` calculation or transaction capabilities.

| Capability interface | Methods | Guard |
| --- | --- | --- |
| `AccountingCategoryCapable` | category create, list, retrieve, update, and delete | `isAccountingCategoryCapable` |
| `AccountingTaxRateCapable` | bookkeeping tax-rate create, list, retrieve, update, and delete | `isAccountingTaxRateCapable` |
| `AccountingLabelCapable` | label create, list, retrieve, update, and delete | `isAccountingLabelCapable` |
| `AccountingExpenseReadCapable` | `listAccountingExpenses`, `retrieveAccountingExpense` | `isAccountingExpenseReadCapable` |
| `AccountingExpenseCapable` | expense reads plus `updateAccountingExpense` | `isAccountingExpenseCapable` |
| `AccountingLedgerCapable` | ledger-entry list and retrieve | `isAccountingLedgerCapable` |

Expense access is deliberately split by behavior. A read-only provider advertises `expenseReads` and
implements `AccountingExpenseReadCapable`. A provider may advertise `expenses` only when it also
implements updates through `AccountingExpenseCapable`. This keeps capability sets honest without
weakening the existing full expense contract.

### IdentityProvider

Identity providers expose verification-session lifecycle operations through an independent registry.
Normalized results contain opaque references and status data only; raw documents, images, biometric
data, national identifiers, and provider verification reports are excluded from the contracts.

### TerminalProvider

Terminal providers expose in-person device discovery and server-driven payment actions through an
independent registry. Their DTOs contain device and action identifiers but no card-present secrets,
and the contracts do not require browser, mobile, Bluetooth, or hardware SDK dependencies.

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
