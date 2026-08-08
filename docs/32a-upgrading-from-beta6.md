# Upgrading from 1.0.0-beta6

The next prerelease introduces provider-neutral customers, products, prices, subscriptions, payments,
and paginated adapter reads. This guide covers the required database and application changes from
`1.0.0-beta6`.

## Upgrade order

1. Back up the database and record the currently deployed package version.
2. Stop catalog and subscription writes during the migration window.
3. Upgrade the package without changing application calls.
4. Run the storage migration and verify every backfill.
5. Deploy application changes that use canonical local resources.
6. Restore writes after the verification queries return no rows.

Knex users run the idempotent migration:

```ts
import { migrate } from '@akira-io/payable';

await migrate(db);
```

The relevant ledger steps are:

- `008-customer-provider-bindings`: moves customer provider identities into bindings.
- `009-catalog-tenant-keys`: normalizes legacy catalog tenancy.
- `011-canonical-local-catalog`: creates canonical products, prices, and their binding tables.
- `015-canonical-local-subscriptions`: adds local subscription terms and provider bindings.
- `016-provider-neutral-page-indexes`: adds deterministic collection indexes.
- `017-canonical-provider-catalog-backfill`: copies legacy products and prices into canonical
  resources and creates provider bindings.

Step `017` preserves product IDs, price IDs, tenant ownership, product relationships, active state,
timestamps, product metadata, currency, amount, recurrence interval, and recurrence count. A
provider identifier becomes a separate binding. A null provider identifier produces a canonical
resource without a binding.

The migration stops with an actionable error when it finds an orphaned price, a cross-tenant or
cross-provider product relationship, conflicting canonical fields, or a binding collision. It does
not choose a record or overwrite canonical data. Correct the reported row and run `migrate(db)`
again. Completed batches are idempotent, and the ledger records step `017` only after verification.

## Prisma migration sequence

Prisma users own their migration SQL. Sync the reference models, generate a draft migration, and
edit it before applying:

```sh
bunx payable-prisma sync
bunx prisma migrate dev --create-only --name payable_canonical_resources
```

Apply the following stages in one reviewed migration:

1. Expand the schema with the canonical tables, binding tables, local subscription columns,
   `tenant_key` columns, consistency checks, and collection indexes from
   `prisma/schema.prisma`.
2. Normalize every legacy `tenant_key` to `COALESCE(tenant_id, '')`.
3. Abort if a legacy price has no product, or if its product has a different `tenant_key` or
   provider.
4. Abort if a canonical row with the same ID differs in any preserved field.
5. Insert canonical products with the legacy product ID.
6. Insert product bindings for rows with a non-null `provider_product_id`. The legacy product ID
   can be used as the deterministic binding ID.
7. Insert canonical prices with the legacy price ID. Set `type` to `recurring` when `interval`
   is non-null and to `one_time` otherwise. Set `description` and `lookup_key` to null because
   beta6 does not store those price fields.
8. Insert price bindings for rows with a non-null `provider_price_id`. The legacy price ID can be
   used as the deterministic binding ID.
9. Verify every legacy row and non-null provider identifier has its matching canonical row and
   binding.
10. Add or validate final foreign keys, checks, and unique indexes only after verification.

Use `ON CONFLICT ... DO NOTHING` on PostgreSQL and SQLite. Use `INSERT IGNORE` on MySQL and
MariaDB. Conflict suppression is valid only for retrying an identical row. Run null-safe comparison
queries before each insert and abort when existing canonical fields or bindings differ.

The migration must keep `payable_products` and `payable_prices`. They serve the explicit
provider-first compatibility API and are not reinterpreted as canonical storage.

## API compatibility

The local ID and provider ID remain different namespaces:

- `payable.products(tenantId)` accepts canonical product IDs.
- `payable.prices(tenantId)` accepts canonical price IDs.
- `payable.canonicalSubscriptions(tenantId)` accepts canonical subscription IDs.
- `payable.storedPayments(tenantId)` accepts stored payment IDs.
- `payable.providerCatalog(providerName, tenantId)` accepts provider product and price IDs.

Payable never retries a failed canonical lookup as a provider lookup. Pass the wrong identity type
and the operation returns the corresponding not-found error.

The provider-first catalog remains available as an explicit compatibility surface in this
prerelease. It is not marked deprecated and has no removal date. A future deprecation must include a
separate announcement, migration period, and replacement mapping.

## Entity and collection changes

- `Customer` no longer carries `provider` or `providerCustomerId`. Read those values from
  `CustomerProviderBinding`.
- Canonical products and prices use stable local IDs. Provider identities live in
  `ProductProviderBinding` and `PriceProviderBinding`.
- A canonical subscription may exist without provider credentials. Accepted price terms are stored
  on the subscription and do not change when a price is archived.
- Provider-neutral collection methods return
  `{ items, nextCursor, hasMore }`. Provider-first compatibility methods keep their documented
  array or provider-page shapes.
- Express, Fastify, NestJS, and MCP expose canonical reads separately from provider-native routes
  and tools.

## Storage-only verification

Start Payable without providers after migration:

```ts
const payable = createPayable({ storage });

await payable.customers(undefined, tenantId).list({ limit: 10 });
await payable.products(tenantId).list({ limit: 10 });
await payable.prices(tenantId).list({ limit: 10 });
await payable.canonicalSubscriptions(tenantId).list({ limit: 10 });
await payable.storedPayments(tenantId).list({ limit: 10 });
```

These calls must not resolve a provider or require provider credentials. Provider synchronization,
checkout, charges, refunds, billing portals, and provider webhooks still require the relevant
provider capability.

## Rollback

The schema migration is forward-only. Do not drop canonical tables or bindings after the new
application writes to them. Restore the pre-upgrade backup if the migration cannot be corrected
before deployment. After deployment, fix the reported data and rerun the idempotent migration.
