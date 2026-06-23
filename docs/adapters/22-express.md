# Express Adapter

`@akira-io/payable/express` exposes `createExpressPayableRoutes(payable, options?)`, which builds
an Express `Router` wired to a `Payable` instance. The router is mounted under a base path of your
choosing; every route is relative to that mount point.

Source: `src/presentation/express/create-express-payable-routes.ts`, `helpers.ts`, and
`routes/*.ts`.

## Purpose

Translate HTTP requests into `Payable` facade calls and `PayableError` instances into HTTP
responses. The adapter owns request parsing (including raw-body parsing for webhooks) and error
mapping; it owns no business logic.

## API

```ts
function createExpressPayableRoutes(
  payable: Payable,
  options?: ExpressPayableOptions,
): Router;

interface ExpressPayableOptions {
  webhookSignatureHeader?: string; // default: 'stripe-signature'
}
```

`createExpressPayableRoutes` registers the route groups in this order, then attaches the error
handler last (`create-express-payable-routes.ts`):

1. `registerWebhookRoutes` - raw-body routes, registered first.
2. `registerCheckoutRoutes`
3. `registerSubscriptionRoutes`
4. `registerCustomerRoutes`
5. `registerInvoiceRoutes`
6. `registerPaymentRoutes`
7. `registerRefundRoutes`
8. `payableErrorHandler` (via `router.use`)

## Routes mounted

Every method and path below is registered by the adapter. Paths are relative to the mount point.

| Method | Path | Status (success) | Source | Behavior |
| --- | --- | --- | --- | --- |
| POST | `/webhooks` | 200 | `routes/webhooks.routes.ts` | Default-provider webhook receipt |
| POST | `/webhooks/:provider` | 200 | `routes/webhooks.routes.ts` | Provider-scoped webhook receipt |
| POST | `/checkout` | 201 | `routes/checkout.routes.ts` | Create a subscription checkout session |
| POST | `/subscriptions/:name/cancel` | 200 | `routes/subscriptions.routes.ts` | Cancel at period end |
| POST | `/subscriptions/:name/cancel-now` | 200 | `routes/subscriptions.routes.ts` | Cancel immediately |
| POST | `/subscriptions/:name/resume` | 200 | `routes/subscriptions.routes.ts` | Resume a canceled subscription |
| POST | `/subscriptions/:name/swap` | 200 | `routes/subscriptions.routes.ts` | Swap to a new price |
| POST | `/refunds` | 201 | `routes/refunds.routes.ts` | Refund a payment |
| POST | `/customers` | 501 | `routes/customers.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/invoices` | 501 | `routes/invoices.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |
| GET | `/payments` | 501 | `routes/payments.routes.ts` | Reserved; throws `NOT_IMPLEMENTED` |

Express is the only adapter that wires `POST /refunds` to a working implementation. The
`/customers`, `/invoices`, and `/payments` handlers exist as reserved endpoints - each immediately
throws `PayableError.notImplemented(...)`, which the error handler maps to HTTP 501.

## Request bodies

Checkout and subscription routes parse and validate their JSON bodies with the shared Zod schemas
in `src/presentation/shared/schemas.ts` (`checkoutBodySchema`, `manageSubscriptionBodySchema`,
`swapSubscriptionBodySchema`). A validation failure throws `PayableError` with code
`VALIDATION_FAILED`, mapped to HTTP 422.

The refund route uses a manual check rather than a Zod schema (`routes/refunds.routes.ts`): a
missing or empty `paymentId` throws `VALIDATION_FAILED` (422). The body shape is
`{ paymentId: string, amount?: { amount: number, currency: string }, reason?: string }`; `amount`
is converted to a `Money` value object before reaching `payable.refund(...)`.

## Raw-body handling for webhooks

The webhook routes install their own body parser; you do not add one. Each route uses
`express.raw({ type: '*/*', limit: '1mb' })` so the handler receives the unparsed request `Buffer`
(`routes/webhooks.routes.ts`):

```ts
router.post('/webhooks', raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }), handler);
router.post('/webhooks/:provider', raw({ type: '*/*', limit: WEBHOOK_BODY_LIMIT }), handler);
```

The handler verifies the body is a `Buffer`. If a JSON body parser ran first (for example a global
`express.json()` mounted ahead of the router), `req.body` is no longer a `Buffer` and the handler
throws `PayableError` with code `INVALID_WEBHOOK_PAYLOAD` (HTTP 400):

```ts
if (!Buffer.isBuffer(req.body)) {
  throw new PayableError(
    'Webhook body must be the raw request buffer; mount the webhook router before any JSON body parser',
    { code: 'INVALID_WEBHOOK_PAYLOAD' },
  );
}
```

Because the webhook routes are registered first inside the router, and the router installs its own
raw parser, the raw body survives as long as no upstream parser consumes it. Mount the Payable
router before any global JSON parser. This ordering rule is exercised by
`tests/express.test.ts` ("rejects a webhook whose body was parsed by an upstream JSON parser").

The signature is read from the header named by `options.webhookSignatureHeader`, defaulting to
`stripe-signature`. Headers are flattened to `Record<string, string>` via `flattenHeaders` and
forwarded to `payable.receiveWebhook(...)`.

## Error mapping

The router's final middleware is `payableErrorHandler` (`helpers.ts`), which delegates to the
shared mappers in `src/presentation/shared/payable-http.ts`:

```ts
export function payableErrorHandler(error, _req, res, _next): void {
  res.status(payableErrorStatus(error)).json(payableErrorBody(error));
}
```

- `payableErrorStatus` maps `PayableError.code` to an HTTP status via `STATUS_BY_CODE`; an unknown
  code falls back to 500. A non-`PayableError` is always 500.
- `payableErrorBody` returns `{ error: string, message: string }`: `error` is the error code,
  `message` is the error message. A non-`PayableError` returns
  `{ error: 'INTERNAL_ERROR', message: 'Unexpected error' }`.

Code-to-status table (`payable-http.ts`):

| Code | Status |
| --- | --- |
| `NOT_IMPLEMENTED` | 501 |
| `INVALID_WEBHOOK_SIGNATURE` | 400 |
| `INVALID_WEBHOOK_PAYLOAD` | 400 |
| `WEBHOOK_PROVIDER_AMBIGUOUS` | 400 |
| `VALIDATION_FAILED` | 422 |
| `PROVIDER_NOT_FOUND` | 404 |
| `CUSTOMER_NOT_FOUND` | 404 |
| `SUBSCRIPTION_NOT_FOUND` | 404 |
| `IDEMPOTENCY_CONFLICT` | 409 |
| `IDEMPOTENCY_IN_PROGRESS` | 409 |
| `PROVIDER_CAPABILITY_NOT_SUPPORTED` | 422 |
| `CHECKOUT_PRICE_REQUIRED` | 422 |
| `CHECKOUT_LINE_ITEMS_REQUIRED` | 422 |
| `SUBSCRIPTION_PRICE_REQUIRED` | 422 |
| `PAYMENT_NOT_FOUND` | 404 |
| `WEBHOOK_EVENT_NOT_FOUND` | 404 |
| `WEBHOOK_REPLAY_DENIED` | 403 |
| `WEBHOOK_STORAGE_REQUIRED` | 500 |
| (any other code, or non-`PayableError`) | 500 |

## No built-in authentication

The adapter installs no authentication or authorization middleware. Every route except the webhook
routes is unprotected at the adapter level:

- `/checkout`, `/subscriptions/:name/*`, and `/refunds` accept whatever `billable` or `paymentId`
  the request supplies. The adapter does not verify that the caller owns the billable record or the
  payment.
- The webhook routes are protected only by provider signature verification (performed inside
  `payable.receiveWebhook`), not by request authentication.

Authenticating the request and verifying ownership of the billable or payment is the caller's
responsibility. Add your own middleware ahead of the Payable router (after any webhook-safe
ordering concerns). See `docs/26-security.md`.

## Mounting example

```ts
import express from 'express';
import { createPayable } from '@akira-io/payable';
import { createExpressPayableRoutes } from '@akira-io/payable/express';

const payable = createPayable({ providers: { stripe: stripeProvider }, storage });

const app = express();

// Mount the Payable router BEFORE any global JSON parser so the raw
// webhook body survives. The router installs its own raw parser for /webhooks.
app.use('/billing', createExpressPayableRoutes(payable));

// Any global body parser belongs after the Payable router.
app.use(express.json());

app.listen(3000);
```

With a custom signature header:

```ts
app.use(
  '/billing',
  createExpressPayableRoutes(payable, { webhookSignatureHeader: 'paddle-signature' }),
);
```

## Edge cases

- A webhook with multiple registered providers but no `:provider` segment surfaces
  `WEBHOOK_PROVIDER_AMBIGUOUS` (400) from the facade - route such webhooks to `/webhooks/:provider`.
- Webhook receipt requires a storage driver; without one the facade throws
  `WEBHOOK_STORAGE_REQUIRED` (500).
- The reserved 501 endpoints are intentional placeholders, not bugs.

---

[Previous: Queue](../persistence/21-queue.md) | [Index](../00-index.md) | [Next: Fastify](23-fastify.md)
