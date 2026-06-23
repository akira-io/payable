# Fastify Adapter

`@akira-io/payable/fastify` exposes `createFastifyPayablePlugin(payable, options?)`, which returns a
`FastifyPluginAsync`. Register it on a Fastify instance, optionally under a route prefix.

Source: `src/presentation/fastify/create-fastify-payable-plugin.ts`, `helpers.ts`, and
`routes/*.ts`.

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

The plugin (`create-fastify-payable-plugin.ts`) performs, in order:

1. `fastify.setErrorHandler(payableErrorReply)`.
2. Registers webhook routes inside a nested `fastify.register(...)` scope.
3. Registers checkout routes.
4. Registers subscription routes.
5. Registers placeholder routes.

## Routes registered

| Method | Path | Status (success) | Source | Behavior |
| --- | --- | --- | --- | --- |
| POST | `/webhooks` | 200 | `routes/webhooks.routes.ts` | Default-provider webhook receipt |
| POST | `/webhooks/:provider` | 200 | `routes/webhooks.routes.ts` | Provider-scoped webhook receipt |
| POST | `/checkout` | 201 | `routes/checkout.routes.ts` | Create a subscription checkout session |
| POST | `/subscriptions/:name/cancel` | 200 | `routes/subscriptions.routes.ts` | Cancel at period end |
| POST | `/subscriptions/:name/cancel-now` | 200 | `routes/subscriptions.routes.ts` | Cancel immediately |
| POST | `/subscriptions/:name/resume` | 200 | `routes/subscriptions.routes.ts` | Resume a canceled subscription |
| POST | `/subscriptions/:name/swap` | 200 | `routes/subscriptions.routes.ts` | Swap to a new price |
| POST | `/customers` | 501 | `routes/placeholder.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/invoices` | 501 | `routes/placeholder.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/payments` | 501 | `routes/placeholder.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |
| POST | `/refunds` | 501 | `routes/placeholder.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |

## Parity gap vs Express

This adapter is a strict subset of the Express adapter. Despite the README stating the adapters
"mount the same routes," the Fastify plugin does not implement the full route set.

What Fastify implements: webhooks, checkout, and subscription management (`cancel`, `cancel-now`,
`resume`, `swap`).

What Fastify does NOT implement:

- `POST /refunds` - Express runs the real refund path; Fastify's `/refunds` is a placeholder that
  throws `PayableError.notImplemented('POST /refunds')` (HTTP 501).
- `POST /customers`, `GET /invoices`, `GET /payments` - placeholders that throw `NOT_IMPLEMENTED`
  (HTTP 501), matching Express's reserved endpoints.

All four placeholder routes live in `routes/placeholder.routes.ts`:

```ts
scope.post('/customers', async () => { throw PayableError.notImplemented('POST /customers'); });
scope.get('/invoices', async () => { throw PayableError.notImplemented('GET /invoices'); });
scope.get('/payments', async () => { throw PayableError.notImplemented('GET /payments'); });
scope.post('/refunds', async () => { throw PayableError.notImplemented('POST /refunds'); });
```

Practical consequence: to process refunds over HTTP today, use the Express adapter or call
`payable.refund(...)` directly. See `docs/29-troubleshooting.md`.

Unlike the Express checkout/subscription routes, the Fastify checkout and subscription handlers do
not run the shared Zod schemas; they cast the request body to a TypeScript interface
(`request.body as CheckoutRequestBody`). Malformed bodies are not rejected with `VALIDATION_FAILED`
the way Express rejects them.

## Raw-body handling for webhooks

The webhook routes are registered inside a dedicated `fastify.register(...)` scope. Within that
scope (`routes/webhooks.routes.ts`), the plugin removes all content-type parsers and installs a
single buffer parser, so the webhook handler receives the raw request `Buffer`:

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

`payableErrorReply` (`helpers.ts`) is set as Fastify's error handler and delegates to the shared
mappers:

```ts
export function payableErrorReply(error, _request, reply): void {
  reply.status(payableErrorStatus(error)).send(payableErrorBody(error));
}
```

Status and body follow the same `STATUS_BY_CODE` table and `{ error, message }` shape documented in
`docs/adapters/22-express.md`. `tests/fastify.test.ts` confirms `INVALID_WEBHOOK_SIGNATURE` maps to
400 and the placeholder routes map to 501.

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
- A request to `/refunds` returns 501, not 404 - the route exists but is unimplemented.

---

[Previous: Express](22-express.md) | [Index](../00-index.md) | [Next: NestJS](24-nestjs.md)
