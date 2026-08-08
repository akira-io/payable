# Prisma Storage

`PrismaStorageDriver` is an official storage adapter that satisfies the same `StorageDriver` contract
as `KnexStorageDriver`, backed by a Prisma Client. It is published from the subpath
`@akira-io/payable/prisma` and keeps Prisma an optional dependency: the core package never imports it,
and the adapter itself imports nothing from `@prisma/client` (it accepts a structurally typed client),
so the zero-peer-dependency guarantee of the core entry is preserved.

## Transaction-scoped audit events

`PrismaAuditLogRepository` is exported from `@akira-io/payable/prisma`. A host can construct it over
an existing Prisma transaction and pass it to `AuditResource`:

```ts
await prisma.$transaction(async (transaction) => {
  const repository = new PrismaAuditLogRepository(transaction, clock, auditKey);
  await new AuditResource(repository, tenantId).record(event);
});
```

Use the same clock and audit key as `PrismaStorageDriver`. The transaction-scoped repository makes
the host mutation and audit append roll back together. See
[Custom domain audit](../examples/46-custom-domain-audit.md) for a complete example.

## Installation

Prisma is an optional peer dependency. Install it in your application:

```bash
bun add prisma @prisma/client
```

The core `@akira-io/payable` entry works without Prisma installed; only `@akira-io/payable/prisma`
requires it.

## Required schema

The adapter maps to the same physical tables as the Knex driver (every table is prefixed `payable_`).
A reference schema ships with the package at `prisma/schema.prisma` and is reproduced below. Copy these
models into your own `schema.prisma`, adjusting the `datasource` and `generator` blocks for your setup.

Key points:

- String/UUID primary keys, supplied by the application (`crypto.randomUUID()`); no `@default`.
- Money columns are `BigInt` (minor units) - matches the Knex `bigint` columns exactly.
- JSON-bearing columns (`metadata`, `payload`, audit `before`/`after`, outbox `payload`, ...) are
  mapped as `String` (text), so a database created by either adapter is byte-compatible with the other.
- `tenant_id` is `@default("")` on `payable_webhook_events`, `payable_idempotency_keys`, and
  `payable_audit_logs`; nullable elsewhere.

```prisma
model PayablePayment {
  id                String          @id
  tenantId          String?         @map("tenant_id")
  tenantKey         String          @default("") @map("tenant_key")
  customerId        String?         @map("customer_id")
  provider          String
  providerPaymentId String?         @map("provider_payment_id")
  status            String
  currency          String
  amount            BigInt
  refundedAmount    BigInt          @map("refunded_amount")
  reference         String?
  description       String?
  createdAt         DateTime        @map("created_at")
  updatedAt         DateTime        @map("updated_at")
  refunds           PayableRefund[]

  @@unique([provider, providerPaymentId])
  @@index([customerId, createdAt, id])
  @@index([tenantKey, createdAt, id])
  @@map("payable_payments")
}
```

See `prisma/schema.prisma` for the full model set. It includes canonical products, canonical prices,
product-provider bindings, price-provider bindings, canonical subscription snapshots, and
subscription-provider bindings alongside the legacy provider-first catalog and the remaining billing,
webhook, audit, outbox, and idempotency models.

## Automated schema sync

Prisma reads a single project-owned schema, so the models cannot be injected from this package
at generate time. To avoid hand-copying them, the package ships a models-only fragment
(`prisma/models.prisma`, no `datasource`/`generator`) plus a `payable-prisma` CLI. Combined with
Prisma's multi-file schema folder (`prisma/schema/`), the models stay managed by the package:

```bash
bunx payable-prisma sync         # writes prisma/schema/payable.prisma
bunx payable-prisma sync <path>  # custom destination
bunx payable-prisma print        # write the models to stdout
```

Keep your `datasource` and `generator` blocks in your own file under `prisma/schema/` (for example
`prisma/schema/schema.prisma`); Prisma merges every `.prisma` file in the folder. Re-run
`payable-prisma sync` after upgrading the package to pull schema changes. The full single-file
reference (with `datasource`/`generator`) remains at `prisma/schema.prisma` for non-folder setups.

The same copy is available programmatically:

```ts
import { writePayableModels } from '@akira-io/payable/prisma';

writePayableModels(); // -> prisma/schema/payable.prisma
```

## Migrations are your responsibility

Unlike the Knex driver, the Prisma adapter does **not** ship a `migrate()` runner. Prisma owns the
migration lifecycle: keep `schema.prisma` as the source of truth and run Prisma's own tooling.

```bash
bunx prisma migrate dev      # local development
bunx prisma migrate deploy   # production
```

Because the physical schema matches the Knex migrations, an existing Payable database created with the
Knex `migrate()` is compatible with the Prisma models (introspect with `prisma db pull` if you adopt
Prisma on top of an existing Payable install).

### Canonical local catalog migration

The four canonical catalog models are additive. Generate a Prisma migration that creates
`payable_canonical_products`, `payable_canonical_prices`,
`payable_product_provider_bindings`, and `payable_price_provider_bindings`. Keep the composite
tenant-key foreign keys and unique constraints emitted by the reference schema. Do not copy legacy
provider catalog rows into these tables in this migration; legacy backfill and contract changes are a
separate migration stage.

### Catalog tenant-key migration

Apply this change as an expand, backfill, verify, contract migration. It is datasource-neutral: use
the SQL syntax required by the database provider in the generated Prisma migration.

1. Expand both catalog tables with a non-null `tenant_key` column that defaults to `''`. The Prisma
   schema's `@@unique([tenantKey, provider, providerProductId])` and
   `@@unique([tenantKey, provider, providerPriceId])` declarations describe the final state. The
   generated migration must defer both tenant-key unique constraints until the contract stage, after
   all four checks return no rows.
2. Backfill products and prices in bounded batches. Select only rows whose normalized key is stale,
   update those ids, and repeat independently for each table. The parameter names show values supplied
   by the migration runner:

```sql
SELECT id
FROM payable_products
WHERE tenant_key <> COALESCE(tenant_id, '')
ORDER BY id
LIMIT :batchSize;

UPDATE payable_products
SET tenant_key = COALESCE(tenant_id, '')
WHERE id IN (:productIds);

SELECT id
FROM payable_prices
WHERE tenant_key <> COALESCE(tenant_id, '')
ORDER BY id
LIMIT :batchSize;

UPDATE payable_prices
SET tenant_key = COALESCE(tenant_id, '')
WHERE id IN (:priceIds);
```

3. Repeat each select and update pair until it selects no ids. This mismatch-driven loop can revisit a
   row inserted below an earlier batch boundary. Verify the backfill before changing constraints:

```sql
SELECT id
FROM payable_products
WHERE tenant_key <> COALESCE(tenant_id, '');

SELECT id
FROM payable_prices
WHERE tenant_key <> COALESCE(tenant_id, '');
```

4. Add and validate an enforced database check equivalent to
   `tenant_key = COALESCE(tenant_id, '')` on both tables. Constraint creation must validate existing
   rows, so a legacy write racing between verification and this step makes the migration fail. Once
   installed, the check rejects later legacy writes that omit the correct tenant key.
5. Check for duplicate normalized identities. Ignore rows whose provider identifier is null because
   the unique constraint permits multiple null values on supported databases.

```sql
SELECT tenant_key, provider, provider_product_id
FROM payable_products
WHERE provider_product_id IS NOT NULL
GROUP BY tenant_key, provider, provider_product_id
HAVING COUNT(*) > 1;

SELECT tenant_key, provider, provider_price_id
FROM payable_prices
WHERE provider_price_id IS NOT NULL
GROUP BY tenant_key, provider, provider_price_id
HAVING COUNT(*) > 1;
```

6. Continue only when both verification queries and both duplicate queries return no rows. Create
   the tenant-key unique constraints, then remove the legacy global product and price constraints.
   A failed verification or duplicate query stops the migration. Correct the rows and resume from the
   verification stage; do not remove a legacy constraint first.

### Payment tenant-key and collection-page index migration

Provider-neutral payment pages read by normalized `tenant_key`. Do not deploy a generated migration
that only adds the column with its `''` default: existing rows with a non-null `tenant_id` would become
invisible to their tenant. Apply the schema change as expand, backfill, verify, contract:

1. Add `payable_payments.tenant_key` as non-null with default `''`, but defer the consistency check and
   collection-page index. Keep the old application version running during this stage.
2. Backfill mismatched rows in bounded, retryable batches until the select returns no ids:

```sql
SELECT id
FROM payable_payments
WHERE tenant_key <> COALESCE(tenant_id, '')
ORDER BY id
LIMIT :batchSize;

UPDATE payable_payments
SET tenant_key = COALESCE(tenant_id, '')
WHERE id IN (:paymentIds);
```

3. Verify that `SELECT id FROM payable_payments WHERE tenant_key <>
   COALESCE(tenant_id, '');` returns no rows. Then add and validate the enforced check constraint named
   `payable_payments_tenant_key_consistency_check` (or the datasource-equivalent generated name).
   This must reject a rolling-deployment write that supplies `tenant_id` without the matching key.
4. Create `(tenant_key, created_at, id)` indexes for customers, canonical products, canonical prices,
   subscriptions, and payments. Deploy the synchronized Prisma models and new application version only
   after the payment backfill, verification, constraint, and indexes succeed.

### Canonical subscription migration

The subscription change is not additive. Do not apply the synchronized Prisma schema directly to an
existing database. Use an expand, backfill, verify, contract migration and keep the application on the
old schema until verification succeeds.

1. Expand `payable_subscriptions` with `tenant_key`, all `accepted_*` snapshot columns,
   `canonical_price_id`, `collection_responsibility`, and `creation_source`. Keep snapshot columns
   nullable for legacy rows. Add `payable_subscription_provider_bindings` without removing or
   relaxing legacy subscription columns yet.
2. Backfill `tenant_key` in bounded batches using the same mismatch-driven loop as the catalog
   migration. Backfill each legacy provider identity into a separate binding. Generate every
   `:bindingId` in the migration runner so the operation does not depend on a database UUID extension:

```sql
INSERT INTO payable_subscription_provider_bindings (
  id, tenant_id, tenant_key, subscription_id, provider,
  provider_subscription_id, provider_synced_at, created_at, updated_at
)
SELECT
  :bindingId, tenant_id, COALESCE(tenant_id, ''), id, provider,
  provider_subscription_id, provider_synced_at, :now, :now
FROM payable_subscriptions
WHERE id = :subscriptionId
  AND provider IS NOT NULL
  AND provider_subscription_id IS NOT NULL;
```

   Process one selected legacy subscription per generated binding id. Skip a row when the normalized
   `(tenant_key, subscription_id, provider)` binding already exists, which makes retries idempotent.
3. Verify tenant normalization, missing bindings, and duplicate identities. Every query must return no
   rows before the contract stage:

```sql
SELECT id FROM payable_subscriptions
WHERE tenant_key <> COALESCE(tenant_id, '');

SELECT s.id
FROM payable_subscriptions s
LEFT JOIN payable_subscription_provider_bindings b
  ON b.tenant_key = COALESCE(s.tenant_id, '')
 AND b.subscription_id = s.id
 AND b.provider = s.provider
 AND b.provider_subscription_id = s.provider_subscription_id
WHERE s.provider IS NOT NULL
  AND s.provider_subscription_id IS NOT NULL
  AND b.id IS NULL;

SELECT tenant_key, customer_id, name
FROM payable_subscriptions
GROUP BY tenant_key, customer_id, name
HAVING COUNT(*) > 1;

SELECT tenant_key, provider, provider_subscription_id
FROM payable_subscription_provider_bindings
GROUP BY tenant_key, provider, provider_subscription_id
HAVING COUNT(*) > 1;
```

4. Add and validate the tenant-key consistency check. Create the tenant-scoped subscription and
   binding unique constraints. Only then remove the legacy global subscription constraints.
5. Relax `payable_subscriptions.provider` to nullable for provider-neutral records. PostgreSQL uses
   `ALTER COLUMN provider DROP NOT NULL`; MySQL/MariaDB uses `MODIFY provider <existing-type> NULL`;
   SQLite requires Prisma's table-rebuild migration. Review the generated SQL for the configured
   datasource instead of copying syntax between databases.
6. Deploy the synchronized Prisma models and application code after the contract migration succeeds.
   Keep `provider` and `provider_subscription_id` populated on legacy subscription rows during this
   release; provider mutations resolve only through the backfilled binding table.

## Usage

```ts
import { PrismaClient } from '@prisma/client';
import { createPayable } from '@akira-io/payable';
import { PrismaStorageDriver } from '@akira-io/payable/prisma';

const prisma = new PrismaClient();
const storage = new PrismaStorageDriver(prisma);

const payable = createPayable({
  providers,
  storage,
});
```

Constructor:

```ts
new PrismaStorageDriver(prisma: PrismaClientLike, clock?: Clock, encryption?: Encryption, auditKey?: string);
```

- `prisma` - your `PrismaClient`. It is accepted as the structural `PrismaClientLike` type; if your
  generated client does not line up structurally, pass `prisma as unknown as PrismaClientLike`.
- `clock` - defaults to `SystemClock`; supplies `created_at` / `updated_at`.
- `encryption` - optional; passed to the webhook-event and webhook-endpoint repositories for payload
  and secret protection (same `Encryption` contract as the Knex driver).
- `auditKey` - optional HMAC key for the audit-log hash chain.

### Idempotency

Idempotency is a separate store, exactly as with Knex. Wire `PrismaIdempotencyRepository` into the
`idempotency.store` option:

```ts
import { PrismaIdempotencyRepository, PrismaStorageDriver } from '@akira-io/payable/prisma';

const payable = createPayable({
  providers,
  storage: new PrismaStorageDriver(prisma),
  idempotency: { store: new PrismaIdempotencyRepository(prisma, clock) },
});
```

### Transactions

`storage.transaction(work)` runs the callback inside `prisma.$transaction`, rebuilding the repository
set bound to the interactive transaction client, so every write in the callback commits or rolls back
together - identical semantics to the Knex driver.

### Catalog mutation durability

With `PrismaStorageDriver`, the product, price, audit, and outbox repositories use the same Prisma
interactive transaction. Entity, audit, and outbox writes occur atomically only when normalized
durable state changes. Each changed mutation writes either its product or price row together with one
audit record and one outbox event. A failure inside the transaction rolls back all three local writes.
Identical state is a no-op with no update, audit record, or outbox event. The provider call occurs
outside this SQL transaction and completes before the local writes begin.

The built-in product and price repositories use an internal compare-and-set operation for concurrent
updates. After a transaction failure, Payable performs one read-after-failure by tenant, provider,
and provider resource ID. If the normalized target is already durable, the call succeeds. Otherwise,
Payable returns `CATALOG_PERSISTENCE_FAILED` with the remote identifier and correlation ID.

The internal compare-and-set method is not part of the public repository contracts. A third-party
`StorageDriver` remains source-compatible and uses its normal transactional `update` method. It can
participate in read-after-failure recovery through the existing `findByProviderId` contract, but it
does not gain the built-in repositories' conditional-update protection.

## Multi-tenancy

`tenantId` scoping mirrors the Knex driver exactly:

- Provider/billable lookups (`findByProviderId`, `listByCustomer`, `list`, ...) treat
  `tenantId === null | undefined` as "no tenant filter" and a concrete value as a scoped filter.
- `payable_webhook_events`, `payable_idempotency_keys`, and `payable_audit_logs` normalize a null tenant
  to the empty string (`tenant_id` default `""`), so those rows are always tenant-scoped.

## Behavior parity and caveats

The adapter preserves Payable behavior exactly, including idempotency acquire/replay/take-over, webhook
deduplication and claim tokens, the audit hash chain, and the transactional outbox. It is implemented
on Prisma's typed delegate API:

- Unique-violation detection keys on Prisma error code `P2002` (idempotency `acquire`, outbox dedupe,
  audit-chain contention retries).
- Outbox `claimPending` uses a token-claim plus read-back pattern rather than `SELECT ... FOR UPDATE
  SKIP LOCKED`; correctness does not depend on row locking (the lock token guards each claim). On
  Postgres/MySQL the Knex driver additionally uses `SKIP LOCKED` as a throughput optimization.
- Tenant-scoped dedupe uniques (outbox `dedupe_key`, webhook deliveries) are expressed as Prisma
  `@@unique` compounds. For a null tenant these rely on the check-before-insert path rather than a
  `COALESCE(tenant_id, '')` expression index, matching the Knex best-effort behavior.

## Supported databases

Any database Prisma supports (PostgreSQL, MySQL, SQLite, ...). The contract test suite runs the adapter
against SQLite; production deployments typically use PostgreSQL. `@prisma/client` is an optional peer
(`>=5`).

---

[Previous: Knex Storage](21-storage-knex.md) · [Index](../00-index.md) · [Next: Queue](22-queue.md)
