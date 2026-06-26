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

## Schema

Tables are split into two groups, each created by a dedicated migration module. Every table name is
prefixed `payable_`, every primary key is a `uuid`, and every table carries `created_at` / `updated_at`
timestamps (except `payable_audit_logs`, which is append-only and has only `created_at`).

### Billing schema

Source: `src/infrastructure/storage/knex/migrations/billing-schema.ts`. These hold the core billing
aggregates.

| Table | Key columns | Notable constraints |
| --- | --- | --- |
| `payable_customers` | `tenant_id`, `provider`, `provider_customer_id`, `billable_type`, `billable_id`, `email` | unique `(provider, provider_customer_id)`; index `(tenant_id, billable_type, billable_id)` |
| `payable_products` | `provider`, `provider_product_id`, `name`, `active` | unique `(provider, provider_product_id)` |
| `payable_prices` | `provider`, `provider_price_id`, `product_id`, `currency`, `unit_amount`, `interval`, `interval_count` | unique `(provider, provider_price_id)`; index `product_id` |
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
| `payable_webhook_events` | `tenant_id` (default `''`), `provider`, `provider_event_id`, `type`, `normalized_type`, `payload`, `data`, `headers`, `status`, `correlation_id`, `received_at`, `processed_at` | unique `(tenant_id, provider, provider_event_id)` (dedup key) |
| `payable_idempotency_keys` | `tenant_id` (default `''`), `key`, `scope`, `operation`, `request_hash`, `response`, `status`, `locked_until`, `expires_at` | unique `(tenant_id, key)` |
| `payable_audit_logs` | `correlation_id`, `actor_type`, `actor_id`, `action`, `resource_type`, `resource_id`, `before`, `after`, `metadata`, `ip_address`, `user_agent` | index `(resource_type, resource_id)`; index `correlation_id`; `created_at` only |
| `payable_outbox_events` | `correlation_id`, `event_type`, `event_version`, `payload`, `status`, `attempts`, `next_retry_at`, `locked_by`, `locked_until` | index `(status, next_retry_at, created_at)` |
| `payable_webhook_endpoints` | `url`, `events`, `secret`, `status` | - |
| `payable_webhook_deliveries` | `endpoint_id`, `event_type`, `payload`, `status`, `attempts`, `response_code`, `response_body`, `next_retry_at` | index `endpoint_id` |

## `migrate(knex)`

Source: `src/infrastructure/storage/knex/migrations/migrate.ts`.

```ts
export async function migrate(knex: Knex): Promise<void> {
  await createBillingTables(knex);
  await createSystemTables(knex);
  await alterExistingTables(knex);
}
```

It runs three steps in order:

1. **Create billing tables** - each via `createIfMissing` (`create-if-missing.ts`), which checks
   `knex.schema.hasTable(name)` and only creates the table when it is absent.
2. **Create system tables** - same `createIfMissing` pattern.
3. **Alter existing tables** - `alterExistingTables` (`alter-existing-tables.ts`) performs additive
   migrations against already-created tables. `ensureColumns` adds a column only when
   `knex.schema.hasColumn` reports it missing (it back-fills `normalized_type` and `data` on
   `payable_webhook_events` for installations created before those columns existed). `ensureIndexes`
   issues `CREATE INDEX IF NOT EXISTS` for the composite keyset indexes:
   `payable_subscriptions_customer_created_id_index`,
   `payable_invoices_customer_created_id_index`, `payable_payments_customer_created_id_index`,
   `payable_refunds_payment_created_id_index`, and `payable_outbox_events_status_locked_index`.

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
- `findById(id)` and the protected `firstWhere` / `manyWhere` query helpers.

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

[Previous: Paddle](../integrations/19-paddle.md) · [Index](../00-index.md) · [Next: Queue](22-queue.md)
