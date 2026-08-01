# Catalog Lifecycle

Read products and prices through the same portable API, then archive or reactivate catalog entries
without deleting provider records.

## Prerequisites

- A configured Payable instance
- A provider that declares `catalogRead` for reads
- A provider that declares `catalogLifecycle` for activation and archival
- The `catalog` capability when creating products or prices

Stripe and Paddle implement all three capabilities.

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

## Failure behavior

| Error code | Cause | Recovery |
| --- | --- | --- |
| `PRODUCT_NOT_FOUND` | Product retrieval or lifecycle target does not exist | Verify the provider and product identifier. |
| `PRICE_NOT_FOUND` | Price retrieval or lifecycle target does not exist | Verify the provider and price identifier. |
| `PROVIDER_CAPABILITY_NOT_SUPPORTED` | The selected provider lacks the required catalog capability | Select a capable provider or disable the operation. |
| `VALIDATION_FAILED` | A list limit is outside 1 through 100 or an adapter input is invalid | Correct the request before retrying. |

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
