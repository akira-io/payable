# Catalog Lifecycle

Read products and prices through the same portable API, then archive or reactivate catalog entries
without deleting provider records.

## Prerequisites

- A configured Payable instance
- A provider that declares `catalogRead` for reads
- A provider that declares `catalogLifecycle` for activation and archival
- The `catalog` capability when creating products or prices

Stripe and Paddle implement all three capabilities.

## Authorize catalog mutations

Catalog mutations require an allowed context when global authorization is enabled or an explicit
authorization context is supplied. When global authorization is disabled and no context is supplied,
they preserve their existing behavior. The host application authenticates the caller and derives the
context from trusted identity data. A known catalog administrator can use
`authorization: { allowed: true, actorId: 'catalog-admin' }`.

```ts
const authorization = { allowed: true, actorId: 'catalog-admin' };
await payable.products().archive('prod_123', { authorization });
await payable.prices().create(
  {
    providerProductId: 'prod_123',
    unitAmount: Money.of(12900, 'USD'),
    interval: 'month',
  },
  { authorization },
);
```

## List products

Catalog lists default to active entries, use a page size of 50, and accept limits from 1 through 100.
`nextCursor` is either an opaque provider cursor for the next request or `null` when the page is
complete. Persist or pass the cursor unchanged. Do not parse it or construct one from an entity ID.

```ts
const page = await payable.products().list({ limit: 50 });
if (page.nextCursor) {
  await payable.products().list({ limit: 50, cursor: page.nextCursor });
}
```

Pass `active: false` to inspect archived products:

```ts
const archivedProducts = await payable.products().list({ active: false });
const product = await payable.products().retrieve('prod_123');
```

`list()` returns `CatalogPage<ProductDTO>`:

```ts
interface CatalogPage<T> {
  data: T[];
  nextCursor: string | null;
}

interface ProductDTO {
  providerProductId: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: Record<string, string> | null;
}
```

## List prices

Price lists use the same pagination and active-state rules. Filter by `providerProductId` when the
application needs prices for one product.

```ts
const archivedPrices = await payable.prices().list({
  providerProductId: 'prod_123',
  active: false,
});
await payable.prices().archive('price_123');
await payable.prices().activate('price_123');
```

Retrieve one price when its provider identifier is already known:

```ts
const price = await payable.prices().retrieve('price_123');
```

`PriceDTO` keeps money provider-neutral through the `Money` value object:

```ts
interface PriceDTO {
  providerPriceId: string;
  providerProductId: string;
  unitAmount: Money;
  interval: 'day' | 'week' | 'month' | 'year' | null;
  intervalCount: number | null;
  description: string | null;
  active: boolean;
}
```

## Archive and reactivate products

Archiving makes a product inactive at the provider. It does not delete the product or its historical
references.

```ts
const archived = await payable.products().archive('prod_123');
const active = await payable.products().activate('prod_123');
```

Payable intentionally exposes no portable product or price delete operation. Stripe and Paddle both
model catalog retirement through active or archived state, and provider records can remain referenced
by existing transactions or subscriptions.

## Change a price

Price monetary terms are immutable through the portable contract. To change an amount, currency,
billing interval, or interval count, create a new price, move new purchases to it, and archive the old
price.

```ts
import { Money } from '@akira-io/payable';

const replacement = await payable.prices().create({
  providerProductId: 'prod_123',
  unitAmount: Money.of(12900, 'USD'),
  interval: 'month',
  intervalCount: 1,
});

await payable.prices().archive('price_123');
```

Create a new price instead of mutating monetary terms on an existing provider price.

## Retry a catalog mutation safely

Pass a stable caller key as the second argument to each product or price mutation:

```ts
await payable.products('stripe-primary', 'tenant-acme').create(
  { name: 'Pro' },
  { idempotencyKey: 'catalog-product-pro-v1' },
);
```

Use the same key and the same input when retrying an uncertain request. Payable rejects a changed
input under the same key with `IDEMPOTENCY_CONFLICT`. A new key represents a new intentional
operation, not another attempt at the earlier operation.

Providers that expose native catalog idempotency receive a derived provider key. Payable does not
forward the raw caller key. Providers without that capability require a configured engine store. If
the store is unavailable, Payable raises `CATALOG_IDEMPOTENCY_STORAGE_REQUIRED` before calling the
provider.

If a non-native provider call has an ambiguous outcome, the first call returns the provider error.
A later call with the same key returns `IDEMPOTENCY_RECONCILIATION_REQUIRED` without repeating the
mutation. List or retrieve the catalog entity and compare its provider identifier and fields with the
intended request. Repair local state when the provider mutation succeeded. Use a new key only when a
new provider mutation is required.

## Persist catalog mutations

When a storage driver is configured, each successful product or price mutation also updates the
local catalog. The provider confirms the mutation before Payable writes the catalog entity, audit
record, and outbox event. A provider mutation cannot share a transaction with local SQL storage, so
this sequence does not provide atomicity across both systems.

The local entity, audit record, and outbox event do share one storage transaction. They commit or
roll back together. Atomicity is limited to those local writes. The same `correlationId` connects
the provider operation, audit record, outbox event, and any persistence error.

Price creation has an additional local preflight. When storage is configured, Payable resolves
`providerProductId` to a local product before calling the provider. A missing product raises
`PRODUCT_NOT_FOUND`, and the provider is not called. Price activation and archival resolve their
parent after the provider returns because the provider response supplies the product identifier.

Without a storage driver, all catalog mutations remain provider-only. Payable does not require a
local product preflight and does not create catalog, audit, or outbox records.

### Recover a confirmed provider mutation

If the provider succeeds but Payable cannot establish the expected local state, the call throws
`CATALOG_PERSISTENCE_FAILED`. Its context contains `resourceType`, `action`, `provider`,
`providerResourceId`, `tenantId`, and `correlationId`. The error `cause` preserves the storage,
audit, outbox, or local parent-resolution failure.

Record the context and reconcile `providerResourceId` with the provider before changing local state.
Do not blindly retry the mutation because the provider may already contain the confirmed result.
Catalog idempotency is not a distributed transaction: remote mutation and local storage cannot
commit atomically. The contract and recovery boundary are tracked in
[issue #997](https://github.com/akira-io/payable/issues/997).

### Recover an idempotency result persistence failure

`IDEMPOTENCY_RESULT_PERSISTENCE_FAILED` means the catalog callback may have succeeded, but Payable
could not verify the completed engine record. The error context preserves the caller key and
`correlationId`. Preserve that correlation ID, then inspect the provider and durable local state to
determine which remote and local writes committed. Do not use a new key before reconciliation because
it represents a new intentional operation.

HTTP and MCP error envelopes include `correlationId` and reconciliation guidance. They do not include
the unverified provider response.

For a native provider, a retry with the same caller key reuses the derived provider identity, but
reconciliation must establish the durable local result before another attempt. For a non-native
provider, the engine keeps the failed operation in reconciliation-required state and a same-key retry
returns `IDEMPOTENCY_RECONCILIATION_REQUIRED` without another provider call. Reconcile first in both
cases; provider idempotency does not make the remote mutation and local commit atomic.

## Failure behavior

| Error code | Cause | Recovery |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND` | Product retrieval or lifecycle target does not exist | Verify the provider and product identifier. |
| `PRICE_NOT_FOUND` | Price retrieval or lifecycle target does not exist | Verify the provider and price identifier. |
| `AUTHORIZATION_DENIED` | Global authorization is enabled with no context, or a supplied context is denied or lacks an actor ID | Authenticate the caller and pass an allowed authorization context. |
| `PROVIDER_CAPABILITY_NOT_SUPPORTED` | The selected provider lacks the required catalog capability | Select a capable provider or disable the operation. |
| `VALIDATION_FAILED` | A list limit is outside 1 through 100 or an adapter input is invalid | Correct the request before retrying. |
| `CATALOG_PERSISTENCE_FAILED` | The provider confirmed a mutation, but its local state could not be recovered | Record the error context and reconcile the remote resource before retrying. |
| `CATALOG_IDEMPOTENCY_STORAGE_REQUIRED` | A caller key targets a provider without native catalog idempotency and no engine store is configured | Configure an idempotency store or omit the key and accept unprotected execution. |
| `IDEMPOTENCY_RECONCILIATION_REQUIRED` | A keyed mutation through a non-native provider previously ended ambiguously | Reconcile with list or retrieve before deciding whether to issue a new operation. |
| `IDEMPOTENCY_RESULT_PERSISTENCE_FAILED` | The catalog callback returned, but the engine could not verify its completed result | Preserve `correlationId`; inspect provider and durable local state; do not use a new key before reconciliation. |

Provider errors are normalized at the catalog boundary. HTTP adapters return both not-found errors as
404 responses. MCP tools return the same Payable error codes in their structured failure response.

## Provider references

The portable behavior above follows the providers' documented list, retrieve, update, and archive
operations:

- [Stripe: list products](https://docs.stripe.com/api/products/list)
- [Stripe: retrieve a product](https://docs.stripe.com/api/products/retrieve)
- [Stripe: update a product](https://docs.stripe.com/api/products/update)
- [Stripe: list prices](https://docs.stripe.com/api/prices/list)
- [Stripe: retrieve a price](https://docs.stripe.com/api/prices/retrieve)
- [Stripe: update a price](https://docs.stripe.com/api/prices/update)
- [Stripe: API errors](https://docs.stripe.com/api/errors)
- [Stripe: error codes](https://docs.stripe.com/error-codes)
- [Paddle: list products](https://developer.paddle.com/api-reference/products/list-products/)
- [Paddle: get a product](https://developer.paddle.com/api-reference/products/get-product/)
- [Paddle: update a product](https://developer.paddle.com/api-reference/products/update-product/)
- [Paddle: list prices](https://developer.paddle.com/api-reference/prices/list-prices/)
- [Paddle: get a price](https://developer.paddle.com/api-reference/prices/get-price/)
- [Paddle: update a price](https://developer.paddle.com/api-reference/prices/update-price/)
- [Paddle: API errors](https://developer.paddle.com/api-reference/about/errors/)
- [Paddle: archive entities](https://developer.paddle.com/api-reference/about/delete-entities/)

---

[Previous: MCP Server](44-mcp-server.md) | [Index](../00-index.md)
