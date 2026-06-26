# Fastify Adapter

`@akira-io/payable/fastify` exposes `createFastifyPayablePlugin(payable, options?)`, which returns a
`FastifyPluginAsync`. Register it on a Fastify instance, optionally under a route prefix.

## Purpose

Bridge Fastify requests to the `Payable` facade and `PayableError` instances to HTTP replies. The
plugin sets a Fastify error handler and registers the webhook routes inside an isolated scope so it
can swap the content-type parser without affecting the rest of the application.

## API

```ts
function createFastifyPayablePlugin(
  payable: Payable,
  options?: FastifyPayableOptions,
): FastifyPluginAsync;

interface FastifyPayableOptions {
  webhookSignatureHeader?: string; // default: 'stripe-signature'
  authenticate?: onRequestHookHandler;
  resolveTenant?: (request: FastifyRequest) => string | null | undefined;
  resolveAuthorization?: (request: FastifyRequest) => AuthorizationContext | undefined;
  rateLimit?: RateLimitPluginOptions;
}
```

The plugin performs, in order:

1. `fastify.setErrorHandler(payableErrorReply)`.
2. Registers `@fastify/rate-limit` with the plugin defaults, merging `options.rateLimit` over them.
3. Registers webhook routes inside a nested `fastify.register(...)` scope.
4. Registers checkout, subscription, refund, customer, read (invoices/payments/subscriptions/refunds),
   and catalog (products/prices) routes inside an authenticated scope. When `options.authenticate` is
   set, it is added as an `onRequest` hook on that scope.

## Routes registered

| Method | Path | Status (success) | Behavior |
| --- | --- | --- | --- |
| POST | `/webhooks` | 200 | Default-provider webhook receipt |
| POST | `/webhooks/:provider` | 200 | Provider-scoped webhook receipt |
| POST | `/checkout` | 201 | Create a subscription checkout session |
| POST | `/subscriptions/:name/cancel` | 200 | Cancel at period end |
| POST | `/subscriptions/:name/cancel-now` | 200 | Cancel immediately |
| POST | `/subscriptions/:name/resume` | 200 | Resume a canceled subscription |
| POST | `/subscriptions/:name/swap` | 200 | Swap to a new price |
| POST | `/customers` | 201 | Create (or get) a customer at the provider |
| PATCH | `/customers` | 200 | Update a customer's email/name |
| GET | `/customers` | 200 | Get a customer by `billableType`+`billableId` (query) |
| GET | `/invoices` | 200 | List a billable's invoices (query: billableType, billableId, limit?) |
| GET | `/invoices/:id/pdf` | 200 | Download an invoice PDF (`application/pdf`; 404 if absent, 422 if the provider lacks `invoicePdf`) |
| GET | `/payments` | 200 | List a billable's payments (query: billableType, billableId) |
| POST | `/products` | 201 | Create a product at the provider |
| PATCH | `/products` | 200 | Update a product |
| POST | `/prices` | 201 | Create a price for a product |
| GET | `/subscriptions` | 200 | List a billable's subscriptions (query: billableType, billableId, limit?) |
| GET | `/subscriptions/:name` | 200 | Get one subscription by name (404 if absent) |
| POST | `/refunds` | 201 | Refund a payment |
| GET | `/refunds` | 200 | List a payment's refunds (query: paymentId, limit?) |

## Parity with Express

This adapter exposes the same route set as Express: webhooks, checkout, subscription management
(`cancel`, `cancel-now`, `resume`, `swap`), subscription reads, customers, invoices, payments,
products, prices, and refunds (create and list).

Every JSON route parses its body or query with the shared Zod schemas in
`src/presentation/shared/schemas.ts` via `parseBody`, so a malformed body is rejected with
`VALIDATION_FAILED` (HTTP 422), the same as Express.

## Raw-body handling for webhooks

The webhook routes are registered inside a dedicated `fastify.register(...)` scope. Within that
scope, the plugin removes all content-type parsers and installs a single buffer parser, so the
webhook handler receives the raw request `Buffer`:

```ts
scope.removeAllContentTypeParsers();
scope.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, done) => {
  done(null, body);
});
```

Because this is done inside an isolated scope, the buffer parser applies only to the webhook routes;
checkout and subscription routes keep Fastify's default JSON parsing. The handler converts the
buffer to a UTF-8 string (or an empty string if it is not a buffer) and forwards payload, signature
(from `options.webhookSignatureHeader`, default `stripe-signature`), and flattened headers to
`payable.receiveWebhook(...)`.

## Rate limiting

The plugin registers `@fastify/rate-limit` before any routes, with these defaults:

```ts
await fastify.register(rateLimit, {
  global: false,
  max: 100,
  timeWindow: '1 minute',
  ...options.rateLimit,
});
```

| Default | Value | Effect |
| --- | --- | --- |
| `global` | `false` | The limiter is opt-in per route, not applied to every route automatically. |
| `max` | `100` | Maximum requests per `timeWindow` for routes that enable the limiter. |
| `timeWindow` | `'1 minute'` | The rolling window the `max` count applies over. |

Pass `options.rateLimit` (typed `RateLimitPluginOptions` from `@fastify/rate-limit`) to override or
extend any of these; the supplied object is spread over the defaults, so it wins on conflicts.

`@fastify/rate-limit` (`>=9`) is declared an **optional peer**. It is imported and registered
unconditionally by the plugin, so it must be installed for the Fastify adapter to load - install it
alongside `fastify` when using this adapter.

## Error mapping

`payableErrorReply` is set as Fastify's error handler and delegates to the shared mappers:

```ts
export function payableErrorReply(error, _request, reply): void {
  reply.status(payableErrorStatus(error)).send(payableErrorBody(error));
}
```

Status and body follow the same `STATUS_BY_CODE` table and `{ error, message }` shape documented in
`docs/adapters/23-express.md`. `INVALID_WEBHOOK_SIGNATURE` maps to 400 and `VALIDATION_FAILED` to 422.

## No built-in authentication

As with Express, the plugin installs no authentication or authorization. The checkout and
subscription routes are unprotected; webhook routes are protected only by provider signature
verification. The caller must authenticate the request and verify ownership of the billable. See
`docs/28-security.md`.

## Registration example

```ts
import Fastify from 'fastify';
import { createPayable } from '@akira-io/payable';
import { createFastifyPayablePlugin } from '@akira-io/payable/fastify';

const payable = createPayable({ providers: { stripe: stripeProvider }, storage });

const app = Fastify();
await app.register(createFastifyPayablePlugin(payable), { prefix: '/billing' });
await app.ready();
```

With a custom signature header:

```ts
await app.register(
  createFastifyPayablePlugin(payable, { webhookSignatureHeader: 'paddle-signature' }),
  { prefix: '/billing' },
);
```

The `prefix` option is Fastify's standard register option; all routes above are mounted beneath it
(for example `POST /billing/webhooks`).

## Edge cases

- Multiple registered providers with no `:provider` segment surface `WEBHOOK_PROVIDER_AMBIGUOUS`
  (400) from the facade.
- Webhook receipt requires a storage driver (`WEBHOOK_STORAGE_REQUIRED`, 500, when absent).
- `GET /subscriptions/:name` returns 404 when the named subscription does not exist.

---

[Previous: Express](23-express.md) | [Index](../00-index.md) | [Next: NestJS](25-nestjs.md)
