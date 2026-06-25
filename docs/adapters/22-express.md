# Express Adapter

`@akira-io/payable/express` exposes `createExpressPayableRoutes(payable, options?)`, which builds
an Express `Router` wired to a `Payable` instance. The router is mounted under a base path of your
choosing; every route is relative to that mount point.

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
  authenticate?: RequestHandler; // optional auth middleware, applied after webhook routes
}
```

`createExpressPayableRoutes` registers the route groups in this order, then attaches the error
handler last:

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
| GET | `/refunds` | 200 | List a payment's refunds (query: paymentId, limit?) |

All routes above are wired to working implementations. `/customers` (POST/PATCH/GET), `/invoices`,
and `/payments` resolve a `Payable` resource for the request's billable (and tenant, when tenancy is
on). The `GET` read routes take `billableType` and `billableId` as query parameters; `/invoices`
also accepts an optional `limit`.

## Request bodies

Checkout and subscription routes parse and validate their JSON bodies with the shared Zod schemas
in `src/presentation/shared/schemas.ts` (`checkoutBodySchema`, `manageSubscriptionBodySchema`,
`swapSubscriptionBodySchema`). A validation failure throws `PayableError` with code
`VALIDATION_FAILED`, mapped to HTTP 422.

The refund route validates the body with `refundBodySchema` via `parseBody` (Zod): an invalid or
missing `paymentId` throws `VALIDATION_FAILED` (422). The body shape is
`{ paymentId: string, amount?: { amount: number, currency: string }, reason?: string }`; `amount`
is converted to a `Money` value object before reaching `payable.refund(...)`.

## Raw-body handling for webhooks

The webhook routes install their own body parser; you do not add one. Each route uses
`express.raw({ type: '*/*', limit: '1mb' })` so the handler receives the unparsed request `Buffer`:

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
router before any global JSON parser.

The signature is read from the header named by `options.webhookSignatureHeader`, defaulting to
`stripe-signature`. Headers are flattened to `Record<string, string>` via `flattenHeaders` and
forwarded to `payable.receiveWebhook(...)`.

## Error mapping

The router's final middleware is `payableErrorHandler`, which delegates to the shared mappers in
`src/presentation/shared/payable-http.ts`:

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

Code-to-status table:

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
responsibility. Pass an `authenticate` middleware in `ExpressPayableOptions` to have it applied
inside the router after the webhook routes and before checkout/subscription/refund, or mount your
own middleware ahead of the Payable router. See `docs/26-security.md`.

```ts
app.use(
  '/payable',
  createExpressPayableRoutes(payable, { authenticate: requireApiKey }),
);
```

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
- `GET /subscriptions/:name` returns 404 when the named subscription does not exist.

---

[Previous: Queue](../persistence/21-queue.md) | [Index](../00-index.md) | [Next: Fastify](23-fastify.md)
