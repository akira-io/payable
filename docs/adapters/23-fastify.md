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
}
```

The plugin performs, in order:

1. `fastify.setErrorHandler(payableErrorReply)`.
2. Registers webhook routes inside a nested `fastify.register(...)` scope.
3. Registers checkout routes.
4. Registers subscription routes.
5. Registers placeholder routes.

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
| POST | `/refunds` | 201 | Refund a payment |
| POST | `/customers` | 501 | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/invoices` | 501 | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/payments` | 501 | Reserved; throws `NOT_IMPLEMENTED` |

## Parity gap vs Express

This adapter implements webhooks, checkout, subscription management (`cancel`, `cancel-now`,
`resume`, `swap`), and `POST /refunds` (the same working refund path as Express, replying `201`). It
does not implement the reserved `customers` / `invoices` / `payments` endpoints.

What Fastify does NOT implement:

- `POST /customers`, `GET /invoices`, `GET /payments` - placeholders that throw `NOT_IMPLEMENTED`
  (HTTP 501), matching Express's reserved endpoints.

The three placeholder routes:

```ts
scope.post('/customers', async () => { throw PayableError.notImplemented('POST /customers'); });
scope.get('/invoices', async () => { throw PayableError.notImplemented('GET /invoices'); });
scope.get('/payments', async () => { throw PayableError.notImplemented('GET /payments'); });
```

Unlike the Express checkout/subscription routes, the Fastify checkout and subscription handlers do
not run the shared Zod schemas; they cast the request body to a TypeScript interface
(`request.body as CheckoutRequestBody`). Malformed bodies are not rejected with `VALIDATION_FAILED`
the way Express rejects them.

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

## Error mapping

`payableErrorReply` is set as Fastify's error handler and delegates to the shared mappers:

```ts
export function payableErrorReply(error, _request, reply): void {
  reply.status(payableErrorStatus(error)).send(payableErrorBody(error));
}
```

Status and body follow the same `STATUS_BY_CODE` table and `{ error, message }` shape documented in
`docs/adapters/22-express.md`. `INVALID_WEBHOOK_SIGNATURE` maps to 400 and the placeholder routes
map to 501.

## No built-in authentication

As with Express, the plugin installs no authentication or authorization. The checkout and
subscription routes are unprotected; webhook routes are protected only by provider signature
verification. The caller must authenticate the request and verify ownership of the billable. See
`docs/26-security.md`.

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
- A `/refunds` request with an unknown currency returns `422` (`VALIDATION_FAILED`), not `500`.

---

[Previous: Express](22-express.md) | [Index](../00-index.md) | [Next: NestJS](24-nestjs.md)
