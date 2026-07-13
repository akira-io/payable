# Revolut Webhook Management

`RevolutProvider` implements remote Merchant webhook CRUD through
`ProviderWebhookEndpointManagementCapable`. This is provider configuration and is separate from
Payable's local webhook endpoint repository.

## Operations

- `createWebhookEndpoint(input, ctx)` calls `POST /api/webhooks`.
- `listWebhookEndpoints({ limit })` calls `GET /api/webhooks` and applies the requested limit locally;
  Revolut allows at most 10 registered URLs.
- `retrieveWebhookEndpoint(id)` calls `GET /api/webhooks/{webhook_id}`.
- `updateWebhookEndpoint(input, ctx)` calls `PATCH /api/webhooks/{webhook_id}`.
- `deleteWebhookEndpoint(id, ctx)` calls `DELETE /api/webhooks/{webhook_id}`.

The Merchant API returns `signing_secret` on every webhook response, which maps to
`ProviderWebhookEndpointDTO.signingSecret`. Revolut has no enabled/disabled field, so `status` is
`null`.

These endpoints do not declare `Idempotency-Key`; Payable therefore does not forward the operation
context key. Revolut's signing-secret rotation endpoint remains provider-specific and is not exposed
by the shared contract because Stripe has no equivalent operation.

---

[Revolut Provider](21-revolut.md) · [Index](../00-index.md)
