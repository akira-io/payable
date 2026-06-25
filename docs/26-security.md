# Security

This page describes the security boundaries the library does and does not enforce. The short
version: `@akira-io/payable` performs no request authentication and only minimal authorization. The
caller owns authentication and ownership checks.

## Authentication: none built in

No adapter installs authentication middleware or guards. The Express router, the Fastify plugin,
and the NestJS controller all mount their routes without any auth layer. Identifying and
authenticating the caller is entirely your responsibility.

The only route protected by a cryptographic check is the webhook route, and that check is signature
verification of the provider payload - not authentication of an end user. See "Webhook signature
verification" below.

## Authorization: the policy layer

`src/application/policies/` contains `can-*` policies:

- `can-create-checkout.policy.ts`
- `can-create-subscription.policy.ts`
- `can-cancel-subscription.policy.ts`
- `can-resume-subscription.policy.ts`
- `can-refund-payment.policy.ts`
- `can-replay-webhook.policy.ts`

These enforce business rules, not HTTP request authentication. Each evaluates an
`AuthorizationContext`:

```ts
export interface AuthorizationContext {
  actorType?: string;
  actorId?: string;
  allowed?: boolean;
  tenantId?: string | null;
}

export function isAuthorized(context: AuthorizationContext = {}): boolean {
  return (
    context.allowed === true && typeof context.actorId === 'string' && context.actorId.length > 0
  );
}
```

A policy passes only when the caller passes an explicit `allowed: true` plus a non-empty `actorId`.
The policy does not derive identity from the request; it trusts the context you supply.

Only `CanReplayWebhookPolicy` is wired into an action. `ReplayWebhookAction` calls
`this.policy.authorize(context)` and throws `PayableError` with code `WEBHOOK_REPLAY_DENIED` (HTTP
403) when it returns false. It additionally rejects a tenant mismatch with the same code:

```ts
if (!this.policy.authorize(context)) {
  throw new PayableError('Webhook replay not permitted', { code: 'WEBHOOK_REPLAY_DENIED' });
}
```

The other policies (`can-create-checkout`, `can-create-subscription`, `can-cancel-subscription`,
`can-resume-subscription`, `can-refund-payment`) are internal building blocks; they are not part of
the package's public exports and are not invoked by the checkout, subscription, or refund actions.
Do not rely on them to gate HTTP requests; they do not run automatically on the adapter routes.

The policy layer is authorization for business operations (notably webhook replay), driven by an
explicit context. It is not request authentication, and it is not applied to
checkout/subscription/refund routes by default. Request authentication and ownership-of-billable
checks remain entirely on you.

When `authorization: { enabled: true }` is configured, charge/checkout/subscription/refund calls
require an `AuthorizationContext` with `allowed: true` and a non-empty `actorId`. Each HTTP adapter
exposes a `resolveAuthorization(req)` option (sibling to `resolveTenant`) that maps the authenticated
request to that context and threads it into the write calls:

```ts
createExpressPayableRoutes(payable, {
  resolveAuthorization: (req) => ({
    allowed: true,
    actorId: req.user.id,
    tenantId: req.user.tenantId,
  }),
});
```

The same option exists on the Fastify plugin and the Nest module. Without it, every write returns
`AUTHORIZATION_DENIED` (HTTP 403) while authorization is enabled.

## Webhook signature verification

The webhook route is the only route protected by a cryptographic check. Verification happens inside
the provider before any storage write (`ReceiveWebhookAction` ->
`provider.verifyWebhook({ payload, signature, headers })`). The Stripe and Paddle verifiers live in
`src/infrastructure/providers/*/`-`*-webhook-verifier.ts`. A bad signature surfaces as
`InvalidWebhookSignatureError` (code `INVALID_WEBHOOK_SIGNATURE`, HTTP 400).

The signature is read from a configurable header (`webhookSignatureHeader`, default
`stripe-signature`) and the raw, unparsed body must reach the verifier. See the adapter docs for
raw-body handling: `docs/adapters/22-express.md`, `23-fastify.md`, `24-nestjs.md`.

## Encryption at rest

`NodeEncryptionDriver` (`src/infrastructure/encryption/node-encryption-driver.ts`) implements
AES-256-GCM:

- The constructor rejects an empty/whitespace key with `PayableError` code
  `ENCRYPTION_KEY_REQUIRED`, then derives a 32-byte key via SHA-256 of the supplied secret.
- `encrypt` produces `base64(iv):base64(tag):base64(ciphertext)` with a random 12-byte IV per
  message.
- `decrypt` rejects malformed ciphertext (missing parts) with `ENCRYPTION_INVALID_CIPHERTEXT` and
  verifies the GCM auth tag.

When an `encryption` driver is configured (`PayableConfig.encryption`), the Knex webhook-event
repository seals the stored headers before writing and opens them on read. Webhook headers are
JSON-stringified, redacted, then encrypted at rest. Without an encryption driver, the same fields
are stored in plaintext.

## Header redaction for logging and storage

`redactHeaders` (`src/support/redact-headers.ts`) drops a fixed set of sensitive headers (case
insensitive) before headers are persisted or logged:

```ts
const SENSITIVE_HEADERS = new Set([
  'authorization', 'proxy-authorization', 'cookie', 'set-cookie',
  'stripe-signature', 'paddle-signature',
]);
```

`StoreWebhookEventAction` applies it to incoming webhook headers before they are stored, so the
signature header and any auth cookies never land in storage even when encryption is off.

## Security assumptions and boundaries

- The library trusts the `billable` and `paymentId` supplied in a request. It does not check that
  the authenticated caller owns them.
- The library does not read environment variables; secrets (provider keys, encryption key, Redis
  connection) are passed in by you.
- The webhook route trusts only the provider signature, not the network origin.

## Threat-to-control table

| Threat | Control in library | Caller responsibility |
| --- | --- | --- |
| Forged webhook payload | Provider signature verification before any write (`verifyWebhook`) | Configure the correct signing secret and provider |
| Webhook replay by an unauthorized actor | `CanReplayWebhookPolicy` + tenant match -> `WEBHOOK_REPLAY_DENIED` (403) | Supply a trustworthy `ReplayWebhookContext` (`allowed`, `actorId`, `tenantId`) |
| Sensitive headers leaking into storage/logs | `redactHeaders` strips auth/signature/cookie headers | Avoid logging raw requests elsewhere |
| Stored webhook headers readable at rest | Optional AES-256-GCM encryption of header payload | Configure an `encryption` driver with a high-entropy key |
| Unauthenticated checkout/subscription/refund request | None - routes are open | Authenticate the request (your middleware/guards) |
| Caller acting on a billable they do not own | None - `billable`/`paymentId` are trusted | Verify ownership before delegating to the facade |
| Cross-tenant access | Webhook replay enforces tenant match; tenancy requires a tenant id when enabled (`TENANT_REQUIRED`) | Pass the correct `tenantId`; scope queries to your tenant |

---

[Previous: Data Flows](25-data-flows.md) | [Index](00-index.md) | [Next: Development](27-development.md)
