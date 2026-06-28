# Prisma Storage

`PrismaStorageDriver` is an official storage adapter that satisfies the same `StorageDriver` contract
as `KnexStorageDriver`, backed by a Prisma Client. It is published from the subpath
`@akira-io/payable/prisma` and keeps Prisma an optional dependency: the core package never imports it,
and the adapter itself imports nothing from `@prisma/client` (it accepts a structurally typed client),
so the zero-peer-dependency guarantee of the core entry is preserved.

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
  @@map("payable_payments")
}
```

See `prisma/schema.prisma` for the full set of fifteen models (customers, products, prices,
subscriptions, subscription items, invoices, payments, refunds, webhook events, webhook endpoints,
webhook endpoint events, webhook deliveries, audit logs, outbox events, idempotency keys).

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
