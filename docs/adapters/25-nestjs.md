# NestJS Adapter

`@akira-io/payable/nest` exposes a NestJS dynamic module, a controller, an exception filter, and DI
tokens. Import the module with `PayableModule.forRoot(payable, options?)`.

## Purpose

Expose the Payable facade as a single NestJS controller, mapping route handlers to facade calls and
`PayableError` instances to HTTP responses through an exception filter. The module provides the
`Payable` instance and adapter options through DI tokens.

## Module

```ts
@Module({})
export class PayableModule {
  static forRoot(payable: Payable, options: NestPayableOptions = {}): DynamicModule;
}
```

`forRoot` returns a `DynamicModule` that registers:

- `controllers: [PayableController, PayableReadController]`
- `providers`:
  - `{ provide: PAYABLE_INSTANCE, useValue: payable }`
  - `{ provide: PAYABLE_OPTIONS, useValue: options }`
  - `PayableExceptionFilter`
  - `PayableAuthGuard`
  - `options.authenticate`, only when supplied (so the guard class can be resolved from DI)

The route handlers are split across two controllers: `PayableController` holds the write routes
(webhooks, checkout, subscription management, customers create/update, refunds, products, prices),
and `PayableReadController` holds the `GET` read routes (customers, invoices, payments,
subscriptions, refunds).

```ts
interface NestPayableOptions {
  webhookSignatureHeader?: string; // default: 'stripe-signature'
  authenticate?: Type<CanActivate>; // optional guard class, resolved via PayableAuthGuard
  resolveTenant?: (request: PayableHttpRequest) => string | null | undefined;
  resolveAuthorization?: (request: PayableHttpRequest) => AuthorizationContext | undefined;
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
| POST | `customers` | 201 | `createCustomer` | Create (or get) a customer at the provider |
| PATCH | `customers` | 200 | `updateCustomer` | Update a customer's email/name |
| GET | `customers` | 200 | `getCustomer` | Get a customer by `billableType`+`billableId` |
| GET | `invoices` | 200 | `invoices` | List a billable's invoices |
| GET | `invoices/:id/pdf` | 200 | `getInvoicePdf` | Download an invoice PDF as a `StreamableFile` (`application/pdf`) |
| GET | `payments` | 200 | `payments` | List a billable's payments |
| POST | `products` | 201 | `createProduct` | Create a product at the provider |
| PATCH | `products` | 200 | `updateProduct` | Update a product |
| POST | `prices` | 201 | `createPrice` | Create a price for a product |
| GET | `subscriptions` | 200 | `subscriptions` | List a billable's subscriptions |
| GET | `subscriptions/:name` | 200 | `getSubscription` | Get one subscription by name (404 if absent) |
| GET | `refunds` | 200 | `listRefunds` | List a payment's refunds |
| POST | `refunds` | 201 | `refunds` | Refund a payment |

## Scope and parity vs Express

The NestJS adapter is a single controller exposing the same route set as Express: webhooks, checkout,
subscription management (`cancel`, `cancel-now`, `resume`, `swap`), subscription reads, customers,
invoices, payments, products, prices, and refunds (create and list).

Every JSON route validates its body or query with the shared Zod schemas in
`src/presentation/shared/schemas.ts` via `parseBody`, so a malformed body is rejected with
`VALIDATION_FAILED` (HTTP 422), the same as Express.

## Request body limits

Unlike the Express and Fastify adapters - which apply a built-in 64KB cap on JSON routes and a 1MB
cap on webhook routes - the NestJS adapter sets no body-size limit of its own. NestJS owns the HTTP
server and its body parser, so the controller relies entirely on the host application's parser
configuration. A default Nest deployment is bounded by the platform parser's default (~100KB for
the Express platform), but you do not get the adapter's 64KB/1MB DoS guard automatically.

Configure equivalent limits on the host app to match the other adapters:

```ts
// Express platform (Nest 10+): set per-parser limits
const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.useBodyParser('json', { limit: '64kb' });
app.useBodyParser('raw', { limit: '1mb' }); // for the raw webhook route

// Fastify platform: cap the body at registration
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({ bodyLimit: 1024 * 1024 }),
);
```

Keep the webhook route's limit (1MB) higher than the JSON routes' limit (64KB), and remember the
webhook route also requires `{ rawBody: true }` (see below).

## Raw body requirement

Webhook signature verification needs the raw request body. The controller reads it from
`request.rawBody`, falling back to a string body, then an empty string:

```ts
private extractPayload(request: PayableHttpRequest): string {
  if (Buffer.isBuffer(request.rawBody)) {
    return request.rawBody.toString('utf8');
  }
  if (typeof request.body === 'string') {
    return request.body;
  }
  return '';
}
```

`request.rawBody` is populated by NestJS only when the application is bootstrapped with
`rawBody: true`. Without it, signature verification receives an empty payload and fails. Bootstrap
the app like this:

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

## Authentication

The adapter ships `PayableAuthGuard`, applied to every route except the webhook routes (which are
protected only by provider signature verification). The guard is a no-op unless you pass an
`authenticate` guard class in `NestPayableOptions`: when set, `PayableAuthGuard` resolves that class
from DI and delegates `canActivate` to it; when unset, it allows the request through. Webhook routes
are never guarded.

Pass your guard class via `authenticate` to authenticate the read and write routes, and verify
ownership of the billable yourself. See `docs/28-security.md`.

```ts
PayableModule.forRoot(payable, { authenticate: ApiKeyGuard });
```

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
