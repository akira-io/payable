# Webhooks and Reconciliation

Receive signed provider events, deduplicate delivery, and reconcile the local billing ledger.

## Prerequisites

- A webhook-capable provider with its signing secret configured
- A storage driver for webhook events and reconciled resources
- Access to the raw request body and provider signature headers

## Configuration

Register one route per provider when more than one provider is active. Preserve the raw payload;
parsing and serializing it again can invalidate the signature.

```ts
const provider = request.params.provider;
const rawBody = request.rawBody;
```

## Run the example

```ts
const result = await payable.receiveWebhook({
  provider,
  payload: rawBody,
  signature: String(request.headers['stripe-signature'] ?? ''),
  headers: Object.fromEntries(
    Object.entries(request.headers).map(([name, value]) => [name, String(value ?? '')]),
  ),
});

return {
  received: true,
  eventId: result.webhookEventId,
  duplicate: result.duplicate,
};
```

Return a successful HTTP response after Payable accepts the event. With an asynchronous queue, the
worker performs reconciliation after receipt; with the default sync queue, processing completes in
the request.

## Expected result

Payable verifies the signature, stores the event, deduplicates it by tenant, provider, and provider
event ID, then reconciles matching payments or subscriptions. Audit and outbox records are written
with the same correlation context when configured.

## Failure behavior

Invalid signatures throw `InvalidWebhookSignatureError`. Webhook receipt without storage fails with
`WEBHOOK_STORAGE_REQUIRED`. With multiple providers, omitting `provider` is ambiguous and fails with
`WEBHOOK_PROVIDER_AMBIGUOUS`. Do not acknowledge invalid events as accepted.

---

[Previous: Charges and Refunds](38-charges-refunds.md) | [Index](../00-index.md) | [Next: Fastify and Knex](40-fastify-knex.md)
