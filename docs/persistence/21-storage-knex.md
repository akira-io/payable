# Knex Storage

Persistence is provider-agnostic and pluggable through the `StorageDriver` contract. The shipped
implementation is `KnexStorageDriver`, which works against any SQL database Knex supports.

## The `StorageDriver` contract

Source: `src/domain/contracts/storage-driver.contract.ts`.

```ts
export interface Repositories {
  readonly customers: CustomerRepository;
  readonly products: ProductRepository;
  readonly prices: PriceRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly subscriptionItems: SubscriptionItemRepository;
  readonly invoices: InvoiceRepository;
  readonly payments: PaymentRepository;
  readonly refunds: RefundRepository;
  readonly webhookEvents: WebhookEventRepository;
  readonly auditLogs: AuditLogRepository;
  readonly outboxEvents: OutboxEventRepository;
}

export interface StorageDriver extends Repositories {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

A `StorageDriver` is the eleven aggregate repositories plus a `transaction` method that runs a unit of
work with a transactional copy of those same repositories.

## `KnexStorageDriver`

Source: `src/infrastructure/storage/knex/knex-storage-driver.ts`.

```ts
new KnexStorageDriver(knex: Knex, clock?: Clock, encryption?: Encryption);
```

- `knex` - a configured Knex instance.
- `clock` - defaults to `SystemClock`. Supplies the `created_at` / `updated_at` timestamps.
- `encryption` - optional; passed to the webhook-event repository for payload protection.

The constructor builds all repositories against the base connection. `transaction(work)` calls
`knex.transaction` and rebuilds the repository set bound to the transaction handle `trx`, so every write
inside the callback participates in the same transaction.

```ts
import knex from 'knex';
import { KnexStorageDriver } from '@akira-io/payable';

const db = knex({ client: 'pg', connection: process.env.DATABASE_URL });
const storage = new KnexStorageDriver(db);

await storage.transaction(async (repos) => {
  const customer = await repos.customers.create(/* ... */);
  await repos.subscriptions.create(/* ... */);
  return customer;
});
```

### Catalog mutation durability

With `KnexStorageDriver`, the product, price, audit, and outbox repositories use the same Knex
transaction. Entity, audit, and outbox writes occur atomically only when normalized durable state
changes. Each changed mutation writes either its product or price row together with one audit record
and one outbox event. A failure inside the transaction rolls back all three local writes. Identical
state is a no-op with no update, audit record, or outbox event. The provider call occurs outside this
SQL transaction and completes before the local writes begin.

The built-in product and price repositories use an internal compare-and-set operation for concurrent
updates. After a transaction failure, Payable performs one read-after-failure by tenant, provider,
and provider resource ID. If the normalized target is already durable, the call succeeds. Otherwise,
Payable returns `CATALOG_PERSISTENCE_FAILED` with the remote identifier and correlation ID.

The internal compare-and-set method is not part of the public repository contracts. A third-party
`StorageDriver` remains source-compatible and uses its normal transactional `update` method. It can
participate in read-after-failure recovery through the existing `findByProviderId` contract, but it
does not gain the built-in repositories' conditional-update protection.

## Schema

Tables are split into two groups, each created by a dedicated migration module. Every table name is
prefixed `payable_`, every primary key is a `uuid`, and every table carries `created_at` / `updated_at`
timestamps (except `payable_audit_logs`, which is append-only and has only `created_at`).

### Billing schema

Source: `src/infrastructure/storage/knex/migrations/billing-schema.ts`. These hold the core billing
aggregates.

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| `payable_customers` | `tenant_id`, `billable_type`, `billable_id`, `email`, `name`, `metadata` | unique logical identity over normalized tenant, billable type, and billable id; MySQL stores the normalized value in generated `tenant_key` |
| `payable_customer_provider_bindings` | `customer_id`, `provider`, `provider_customer_id` | foreign key to customer with cascade delete; unique `(customer_id, provider)` and `(provider, provider_customer_id)` |
| `payable_products` | `tenant_id`, `tenant_key`, `provider`, `provider_product_id`, `name`, `active` | check `tenant_key = COALESCE(tenant_id, '')`; unique `(tenant_key, provider, provider_product_id)` through `payable_products_tenant_provider_product_unique` |
| `payable_prices` | `tenant_id`, `tenant_key`, `provider`, `provider_price_id`, `product_id`, `currency`, `unit_amount`, `interval`, `interval_count`, `active` (boolean, notNullable) | check `tenant_key = COALESCE(tenant_id, '')`; unique `(tenant_key, provider, provider_price_id)` through `payable_prices_tenant_provider_price_unique`; index `product_id` |
| `payable_subscriptions` | `customer_id`, `name`, `provider`, `provider_subscription_id`, `status`, `price_id`, `quantity`, period/trial timestamps | unique `(provider, provider_subscription_id)`; unique `(customer_id, name)` |
| `payable_subscription_items` | `subscription_id`, `price_id`, `provider_item_id`, `quantity` | index `subscription_id` |
| `payable_invoices` | `customer_id`, `subscription_id`, `provider`, `provider_invoice_id`, `status`, `currency`, `total`, `amount_paid`, `amount_due` | unique `(provider, provider_invoice_id)`; index `customer_id` |
| `payable_payments` | `customer_id`, `provider`, `provider_payment_id`, `status`, `currency`, `amount`, `refunded_amount`, `reference` | unique `(provider, provider_payment_id)`; index `customer_id` |
| `payable_refunds` | `payment_id`, `provider`, `provider_refund_id`, `status`, `currency`, `amount`, `reason` | unique `(provider, provider_refund_id)`; index `payment_id` |

#### Referential integrity

The split between hard foreign keys and plain indexed columns is deliberate, not an oversight:

- **Composition relationships use real foreign keys with `ON DELETE CASCADE`.** A `payable_subscription_item` cannot exist without its `payable_subscription`, and a `payable_refund` cannot exist without its `payable_payment`. Both children are created in-process alongside their parent, so the parent is always present and a cascade is the correct lifecycle.
- **Cross-aggregate references are indexed columns with application-managed integrity.** `prices.product_id`, `subscriptions.customer_id`, `invoices.customer_id` / `subscription_id`, and `payments.customer_id` point at aggregates that are populated by provider ingestion, which can arrive out of order (a subscription webhook may land before its customer is synced). A database foreign key would reject those inserts, so the application owns the integrity of these edges instead.

When deleting an aggregate root, the application is responsible for cleaning up the indexed references that do not cascade.

### System schema

Source: `src/infrastructure/storage/knex/migrations/system-schema.ts`. These support webhooks,
idempotency, audit, and the outbox.

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| `payable_webhook_events` | `tenant_id` (default `''`), `provider`, `provider_event_id`, `type`, `normalized_type`, `payload`, `signature` (nullable), `data`, `headers`, `status`, `correlation_id`, `occurred_at` (nullable), `received_at`, `processed_at`, `claimed_until` (nullable), `claim_token` (nullable) | unique `(tenant_id, provider, provider_event_id)` (dedup key) |
| `payable_idempotency_keys` | `tenant_id` (default `''`), `key`, `scope`, `operation`, `resource_type` (nullable), `resource_id` (nullable), `request_hash`, `response`, `status`, `locked_until`, `lock_token` (nullable), `expires_at` | unique `(tenant_id, key)` |
| `payable_audit_logs` | `correlation_id`, `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `before`, `after`, `metadata`, `ip_address`, `user_agent`, `previous_hash` (nullable), `hash` (notNullable), `sequence` (integer, notNullable) | index `(resource_type, resource_id)`; index `correlation_id`; unique `(tenant_id, sequence)`; append-only (`created_at` only) |
| `payable_outbox_events` | `tenant_id` (nullable), `correlation_id`, `event_type`, `event_version`, `payload`, `status`, `attempts`, `next_retry_at`, `locked_by`, `locked_until`, `dedupe_key` (nullable) | index `(status, next_retry_at, created_at)` (added by `ensureIndexes`) |
| `payable_webhook_endpoints` | `tenant_id` (nullable), `url`, `events`, `secret` (text, nullable), `status`, `created_at`, `updated_at` | - |
| `payable_webhook_endpoint_events` | `endpoint_id`, `event_type` | composite primary key `(endpoint_id, event_type)`; index `event_type` |
| `payable_webhook_deliveries` | `id` (uuid PK), `tenant_id` (nullable), `endpoint_id`, `event_id` (nullable), `event_type`, `payload`, `status`, `attempts`, `response_code` (nullable), `response_body` (nullable), `next_retry_at` (nullable), `created_at`, `updated_at` | index `endpoint_id`; index `(endpoint_id, event_id)` |

## `migrate(knex)`

Source: `src/infrastructure/storage/knex/migrations/migrate.ts`.

```ts
export async function migrate(knex: Knex): Promise<void> {
  await withMigrationLock(knex, async () => {
    await runStep(knex, '001-billing-tables', () => createBillingTables(knex));
    await runStep(knex, '002-system-tables', () => createSystemTables(knex));
    await runStep(knex, '003-alter-existing-tables', () => alterExistingTables(knex));
    await runStep(knex, '004-widen-endpoint-secret', () => widenEndpointSecret(knex));
    await runStep(knex, '005-webhook-occurred-at', () => addWebhookOccurredAt(knex));
    await runStep(knex, '006-subscription-provider-synced-at', () =>
      addSubscriptionProviderSyncedAt(knex),
    );
    await runStep(knex, '007-post-ledger-schema-convergence', () =>
      convergePostLedgerSchema(knex),
    );
    await runStep(knex, '008-customer-provider-bindings', () =>
      addCustomerProviderBindings(knex),
    );
    await runStep(knex, '009-catalog-tenant-keys', () => addCatalogTenantKeys(knex));
  });
}
```

All steps run inside `withMigrationLock`, which serializes concurrent migrators:

- On **PostgreSQL** it takes a session `pg_advisory_lock` and releases it in a `finally`.
- On **MySQL** / **MariaDB** it takes a named `GET_LOCK` (30s timeout); if the lock is not acquired
  it throws `PayableError` with code `MIGRATION_LOCK_UNAVAILABLE`.
- On any other dialect it runs the steps without a lock.

Each step is recorded through a migration ledger via `runStep`, so a completed step is skipped on a
re-run. The first four steps establish the original schema; steps `005` through `007` add webhook
timestamps, subscription sync timestamps, and post-ledger convergence. The customer identity
migration is step `008`:

1. **Create billing tables** (`001-billing-tables`) - each via `createIfMissing`
   (`create-if-missing.ts`), which checks `knex.schema.hasTable(name)` and only creates the table
   when it is absent.
2. **Create system tables** (`002-system-tables`) - same `createIfMissing` pattern.
3. **Alter existing tables** (`003-alter-existing-tables`) - `alterExistingTables`
   (`alter-existing-tables.ts`) performs additive migrations against already-created tables.
   `ensureColumns` adds a column only when `knex.schema.hasColumn` reports it missing (it back-fills
   `normalized_type` and `data` on `payable_webhook_events` for installations created before those
   columns existed). `ensureIndexes` issues `CREATE INDEX IF NOT EXISTS` for the composite keyset
   indexes: `payable_subscriptions_customer_created_id_index`,
   `payable_invoices_customer_created_id_index`, `payable_payments_customer_created_id_index`,
   `payable_refunds_payment_created_id_index`, and `payable_outbox_events_status_locked_index`.
4. **Widen the endpoint secret** (`004-widen-endpoint-secret`) - `widenEndpointSecret`
   (`widen-endpoint-secret.ts`) alters `payable_webhook_endpoints.secret` to `text` so the column can
   hold encrypted (sealed) secret values, which are longer than a raw secret.
- **Customer provider bindings** (`008-customer-provider-bindings`) - creates
   `payable_customer_provider_bindings`, backfills every non-null legacy provider customer id, verifies
   the backfill, and only then removes `provider` and `provider_customer_id` from
   `payable_customers`.
- **Catalog tenant keys** (`009-catalog-tenant-keys`) - migrates products and prices in this order:
  add non-null `tenant_key` with default `''`; repeatedly select up to 100 mismatched rows ordered by
  `id` and backfill those ids until none remain; verify each value equals
  `COALESCE(tenant_id, '')`; add an enforced consistency check; reject duplicate
  `(tenant_key, provider, provider id)` rows with a non-null provider id; create the normalized unique
  index; then remove the legacy global index.
  The product index is `payable_products_tenant_provider_product_unique`. The price index is
  `payable_prices_tenant_provider_price_unique`.

Step `009-catalog-tenant-keys` is fail-closed. The mismatch-driven batches revisit rows inserted below
an earlier batch boundary. The consistency check validates existing rows when it is added and rejects
later writes that omit the correct tenant key, including writes from an older application instance.
A mismatch, failed check, or duplicate normalized identity throws before the matching legacy index is
removed. The migration ledger entry is written only after both tables finish. Re-running resumes
safely because existing columns, checks, and normalized indexes are retained.

`migrate` is **idempotent and safe to re-run**: it creates nothing that exists and adds only missing
columns/indexes. A second `migrate` resolves cleanly, and a table created before the additive columns
gets them back-filled.

```ts
import knex from 'knex';
import { migrate } from '@akira-io/payable';

const db = knex({ client: 'pg', connection: process.env.DATABASE_URL });
await migrate(db);
```

## Repositories

There is one Knex repository per aggregate, under
`src/infrastructure/storage/knex/repositories/`: `knex-customer`, `knex-product`, `knex-price`,
`knex-subscription`, `knex-subscription-item`, `knex-invoice`, `knex-payment`, `knex-refund`,
`knex-webhook-event`, `knex-audit-log`, `knex-outbox-event`, plus `knex-idempotency`.

They share a base class `KnexRepository<Entity, New>` (`knex-repository.ts`) providing:

- `create(data)` - generates a UUID via `crypto.randomUUID()`, stamps `created_at` / `updated_at` from
  the clock, inserts with `.returning('*')`, and falls back to `findByIdOrFail` when the driver does not
  return the row.
- `createMany(data)` - single batch insert (no-op on an empty array).
- `update(id, patch)` - updates with a fresh `updated_at`.
- `findById(id, tenantId)` and the protected `firstWhere` and `manyWhere` query helpers. Product and
  price repositories require `tenantId`; use `null` for the tenantless partition.

Each concrete repository supplies the `table` name and the `toEntity` / `toRow` column mappers. Shared
column converters live in `mappers.ts` (`toDate`, `toNullableDate`, `fromDate`, `toJson`, `fromJson`,
`stripUndefined`, `toBool`). `stripUndefined` is what lets partial updates skip untouched columns.

## Keyset pagination

List queries use cursor (keyset) pagination, not offsets. Source: `manyWhere` in `knex-repository.ts`
and the `ListOptions` contract (`src/domain/contracts/list-options.contract.ts`).

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

Behavior and guarantees:

- **Ordering** is always `created_at DESC, id DESC` - newest first, with `id` as a deterministic
  tiebreaker. Rows come back newest-first.
- **Cursor semantics**: `before` is the last row of the previous page. The query fetches rows strictly
  *older* than the cursor using a compound predicate:
  `created_at < cursor.createdAt OR (created_at = cursor.createdAt AND id < cursor.id)`. The tie clause
  on `id` is what prevents skipping or duplicating rows that share the same `created_at`.
- **Limit**: `limit` caps page size; omit it to fetch all matching rows.

Both the happy path (paging backwards through a list) and the boundary case hold: paging one row at a
time through four rows with identical `created_at` returns all four exactly once, no skips.

## Supported database clients

`KnexStorageDriver` is client-agnostic; it relies only on standard Knex schema and query building plus
`.returning('*')`. The dev/test client is **`better-sqlite3`**, configured with
`client: 'better-sqlite3'` and shipped in `devDependencies`. `knex` is an optional peer (`>=3`). Any
Knex-supported SQL client (for example PostgreSQL via `pg`) works; install the matching driver in your
application. `pg` is not bundled as a dependency of this package - add it yourself when targeting
PostgreSQL.

---

[Previous: Paddle](../integrations/19-paddle.md) · [Index](../00-index.md) · [Next: Prisma Storage](21b-storage-prisma.md)
