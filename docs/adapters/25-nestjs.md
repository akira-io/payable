# NestJS Adapter

`@akira-io/payable/nest` exposes a NestJS dynamic module, a controller, an exception filter, and DI
tokens. Import the module with `PayableModule.forRoot(payable, options?)`.

## Purpose

Expose the Payable facade through NestJS controllers, mapping route handlers to facade calls and
`PayableError` instances to HTTP responses through an exception filter. The module provides the
`Payable` instance and adapter options through DI tokens.

The module does not register a generic audit-write controller. Inject the configured `Payable`
instance into an authorized host service and call `payable.audit(tenantId)` directly. See
[Custom domain audit](../examples/46-custom-domain-audit.md).

## Module

```ts
@Module({})
export class PayableModule {
  static forRoot(payable: Payable, options: NestPayableOptions = {}): DynamicModule;
}
```

`forRoot` returns a `DynamicModule` that registers:

- `controllers: [PayableController, PayableCatalogController, PayableCanonicalReadController, PayableReadController, PayableSubscriptionsController]`
- `providers`:
  - `{ provide: PAYABLE_INSTANCE, useValue: payable }`
  - `{ provide: PAYABLE_OPTIONS, useValue: options }`
  - `PayableExceptionFilter`
  - `PayableAuthGuard`
  - `options.authenticate`, only when supplied (so the guard class can be resolved from DI)

The route handlers are split across five controllers. `PayableController` holds non-catalog writes,
`PayableCatalogController` holds provider product and price mutations,
`PayableCanonicalReadController` holds provider-neutral collection reads, and
`PayableReadController` holds the compatibility and provider-native reads.
`PayableSubscriptionsController` owns the canonical subscription price migration routes.

```ts
interface NestPayableOptions {
  webhookSignatureHeader?: string; // default: 'stripe-signature'
  authenticate?: Type<CanActivate>; // optional guard class, resolved via PayableAuthGuard
  resolveTenant?: (request: PayableHttpRequest) => string | null | undefined;
  resolveAuthorization?: (request: PayableHttpRequest) => AuthorizationContext | undefined;
  subscriptionPriceMigrationLimits?: {
    bodyLimit?: number;
    rateLimit?: { max?: number; windowMs?: number };
  };
}
```

## DI tokens

The injection tokens and the request shape:

```ts
export const PAYABLE_INSTANCE = Symbol('payable.instance');
export const PAYABLE_OPTIONS = Symbol('payable.options');

export interface PayableHttpRequest {
  headers: IncomingHttpHeaders;
  body?: unknown;
  rawBody?: Buffer;
}
```

`PayableController` injects both tokens:

```ts
constructor(
  @Inject(PAYABLE_INSTANCE) private readonly payable: Payable,
  @Inject(PAYABLE_OPTIONS) private readonly options: NestPayableOptions,
) {}
```

## Controller routes

`PayableController` is decorated with `@Controller()` (no path prefix) and
`@UseFilters(PayableExceptionFilter)`. Routes are defined with method decorators and `@HttpCode`:

| Method | Path | Status | Handler | Behavior |
| --- | --- | --- | --- | --- |
| POST | `webhooks` | 200 | `webhook` | Default-provider webhook receipt |
| POST | `webhooks/:provider` | 200 | `webhookForProvider` | Provider-scoped webhook receipt |
| POST | `checkout` | 201 | `checkout` | Create a subscription checkout session |
| POST | `subscriptions/:name/cancel` | 200 | `cancel` | Cancel at period end |
| POST | `subscriptions/:name/cancel-now` | 200 | `cancelNow` | Cancel immediately |
| POST | `subscriptions/:name/resume` | 200 | `resume` | Resume a canceled subscription |
| POST | `subscriptions/:name/swap` | 200 | `swap` | Swap to a new price |
| POST | `customers` | 201 | `createCustomer` | Create or get a logical customer in local storage |
| PATCH | `customers` | 200 | `updateCustomer` | Update a logical customer's email or name in local storage |
| POST | `customers/sync` | 200 | `syncCustomer` | Synchronize a logical customer with the required provider name |
| GET | `customers` | 200 | `getCustomer` | Get a customer by `billableType`+`billableId` |
| GET | `invoices` | 200 | `invoices` | List a billable's invoices |
| GET | `invoices/:id/pdf` | 200 | `getInvoicePdf` | Download an invoice PDF as a `StreamableFile` (`application/pdf`) |
| GET | `payments` | 200 | `payments` | List a billable's payments |
| GET | `products` | 200 | `listProducts` | List products with `limit`, `cursor`, and `active` query fields |
| GET | `products/:id` | 200 | `getProduct` | Retrieve a product by provider id |
| POST | `products` | 201 | `createProduct` | Create a product at the provider |
| PATCH | `products` | 200 | `updateProduct` | Update a product |
| POST | `products/:id/activate` | 200 | `activateProduct` | Activate a product |
| POST | `products/:id/archive` | 200 | `archiveProduct` | Archive a product without deleting it |
| GET | `prices` | 200 | `listPrices` | List prices with product, state, and cursor filters |
| GET | `prices/:id` | 200 | `getPrice` | Retrieve a price by provider id |
| POST | `prices` | 201 | `createPrice` | Create a price for a product |
| POST | `prices/:id/activate` | 200 | `activatePrice` | Activate a price |
| POST | `prices/:id/archive` | 200 | `archivePrice` | Archive a price without deleting it |
| GET | `subscriptions` | 200 | `subscriptions` | List a billable's subscriptions |
| GET | `subscriptions/:name` | 200 | `getSubscription` | Get one subscription by name (404 if absent) |
| GET | `refunds` | 200 | `listRefunds` | List a payment's refunds |
| POST | `refunds` | 201 | `refunds` | Refund a payment |

`PayableCanonicalReadController` is mounted at `canonical` and exposes page and exact routes for
`customers`, `products`, `prices`, `subscriptions`, and `payments`. For example,
`GET canonical/products` returns `{ items, nextCursor, hasMore }` from local storage and
`GET canonical/products/:id` retrieves one local product. The same pattern applies to the other
four resources. These routes default to 25 items, accept at most 100, use the request tenant, and do
not resolve a provider.

`PayableSubscriptionsController` is mounted at `canonical/subscription-price-migrations`:

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `canonical/subscription-price-migrations` | Create an immutable canonical preview |
| GET | `canonical/subscription-price-migrations` | List a bounded tenant page |
| GET | `canonical/subscription-price-migrations/:id` | Retrieve one migration |
| POST | `canonical/subscription-price-migrations/:id/approve` | Execute or schedule the preview |
| POST | `canonical/subscription-price-migrations/:id/cancel` | Cancel an eligible migration |
| POST | `canonical/subscription-price-migrations/:id/retry` | Retry a recoverable failure |

The create body requires canonical IDs and explicit timing, proration, and payment-failure policies.
Scheduled requests require an RFC 3339 `effectiveAt`; other timings reject it. Every POST requires
exactly one `Idempotency-Key`. All six routes require a non-empty resolved tenant and a matching
allowed authorization context. Lists accept limits from 1 through 100 and opaque cursors. Responses
exclude provider identifiers, execution tokens, request hashes, internal evidence, and provider
diagnostics. Execute and due-page operations are core-only and are not Nest routes.

## Scope and parity with Express

The NestJS adapter exposes the same route set as Express: webhooks, checkout,
subscription management (`cancel`, `cancel-now`, `resume`, `swap`), subscription reads, customers,
invoices, payments, products, prices, refunds (create and list), and canonical subscription price
migrations.

Every JSON route validates its body or query with the shared Zod schemas in
`src/presentation/shared/schemas.ts` via `parseBody`, so a malformed body is rejected with
`VALIDATION_FAILED` (HTTP 422), the same as Express.

Catalog lists return `{ data, nextCursor }`, treat cursors as opaque, default to active entries, and
cap `limit` at 100. Price lists also accept `providerProductId`. The module exposes activation and
archival instead of product or price delete routes. Changing price monetary terms requires creating
a replacement price.

## Request body limits

Subscription price migration mutations require the Payable raw-byte parser boundary. Disable Nest's
default parser, install the exported Express-platform helper before initialization, and give the
module and helper the same limits:

```ts
import { configureNestExpressPayableBodyParser } from '@akira-io/payable/nest';

const subscriptionPriceMigrationLimits = {
  bodyLimit: 64 * 1024,
  rateLimit: { max: 100, windowMs: 60_000 },
};

// Pass subscriptionPriceMigrationLimits to PayableModule.forRoot(...) in AppModule.
const app = await NestFactory.create<NestExpressApplication>(AppModule, {
  bodyParser: false,
});
configureNestExpressPayableBodyParser(app, {
  subscriptionPriceMigrationLimits,
});
await app.init();
```

The helper enforces the limit on streamed raw bytes, including chunked requests, before JSON parsing.
The controller fails closed when the helper is missing or its configured limit differs from the
module limit. It preserves `request.rawBody` by default for webhook signature verification.

## Raw body requirement

Webhook signature verification requires `request.rawBody`; the controller fails closed when it is
not a `Buffer`. `configureNestExpressPayableBodyParser(...)` preserves that buffer by default while
also enforcing the migration JSON limit. If the application does not use that helper, bootstrap
Nest's own parser with `rawBody: true`:

```ts
import { NestFactory } from '@nestjs/core';

const app = await NestFactory.create(AppModule, { rawBody: true });
```

The signature is read from `options.webhookSignatureHeader` (default `stripe-signature`); headers
are flattened with `flattenHeaders` before reaching `payable.receiveWebhook(...)`.

## Exception filter and error mapping

`PayableExceptionFilter` is `@Catch()`-all and delegates to the shared mappers:

```ts
@Catch()
export class PayableExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<HttpResponse>();
    response.status(payableErrorStatus(error)).json(payableErrorBody(error));
  }
}
```

It uses the same `STATUS_BY_CODE` table and `{ error, message }` body shape documented in
`docs/adapters/23-express.md`. An `InvalidWebhookSignatureError` maps to 400 with
`error: 'INVALID_WEBHOOK_SIGNATURE'`, and a plain `TypeError` maps to 500 with
`error: 'INTERNAL_ERROR'`.

## Authentication and catalog authorization

The adapter ships `PayableAuthGuard`, applied to every route except the webhook routes (which are
protected only by provider signature verification). The guard is a no-op unless you pass an
`authenticate` guard class in `NestPayableOptions`: when set, `PayableAuthGuard` resolves that class
from DI and delegates `canActivate` to it; when unset, it allows the request through. Webhook routes
are never guarded.

Pass your guard class via `authenticate` to authenticate the read and write routes, and verify
ownership of the billable yourself. See `docs/28-security.md`.

Canonical subscription price migration routes fail closed even when the optional guard is absent:
`resolveTenant` must return a non-empty tenant and `resolveAuthorization` must return an allowed actor
with that same tenant. The guard or an upstream boundary must authenticate the identity used by those
resolvers.

`PayableAuthGuard` runs before each catalog controller method. After the guard succeeds,
`resolveAuthorization` runs once for the catalog mutation and maps the trusted request identity to an
`AuthorizationContext`. NestJS forwards that object unchanged in `CatalogMutationOptions`; the core
resource makes the final authorization decision. A denied catalog write returns
`AUTHORIZATION_DENIED` before capability validation or provider calls.

```ts
PayableModule.forRoot(payable, { authenticate: ApiKeyGuard });
```

With catalog authorization enabled:

```ts
PayableModule.forRoot(payable, {
  authenticate: ApiKeyGuard,
  resolveAuthorization: (request) => ({
    allowed: true,
    actorId: request.user.id,
    tenantId: request.user.tenantId,
  }),
});
```

## Catalog idempotency

Product and price mutation handlers accept one `Idempotency-Key` header. The controller validates
the header and forwards it as `CatalogMutationOptions.idempotencyKey`. Invalid or duplicate header
lines return `INVALID_IDEMPOTENCY_KEY` with HTTP 400 through `PayableExceptionFilter`.

```bash
curl -X POST https://example.test/products \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: catalog-product-pro-v1' \
  -d '{"name":"Pro"}'
```

Reuse the value for the same tenant, provider, catalog operation, and body. The shared error mapper
returns `IDEMPOTENCY_RECONCILIATION_REQUIRED` as HTTP 409 and
`CATALOG_IDEMPOTENCY_STORAGE_REQUIRED` as HTTP 500. See
[Idempotency](../features/14-idempotency.md) for the complete execution matrix.

## Module example

```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createPayable } from '@akira-io/payable';
import { PayableModule } from '@akira-io/payable/nest';

const payable = createPayable({ providers: { stripe: stripeProvider }, storage });

@Module({
  imports: [PayableModule.forRoot(payable)],
})
export class AppModule {}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  await app.listen(3000);
}
```

With a custom signature header:

```ts
PayableModule.forRoot(payable, { webhookSignatureHeader: 'paddle-signature' });
```

`@nestjs/common` and `reflect-metadata` are optional peer dependencies; install both to use this
adapter.

## Edge cases

- Forgetting `rawBody: true` yields an empty webhook payload and a verification failure.
- Multiple registered providers with no `:provider` route param surface
  `WEBHOOK_PROVIDER_AMBIGUOUS` (400) from the facade.
- `GET subscriptions/:name` returns 404 when the named subscription does not exist.

---

[Previous: Fastify](24-fastify.md) | [Index](../00-index.md) | [Next: MCP](26-mcp.md)
