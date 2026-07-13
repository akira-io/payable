# Revolut Disputes

`RevolutProvider` implements the generic `DisputeCapable` contract for Merchant disputes. These
endpoints are available only in Revolut's production environment; calls configured with
`environment: 'sandbox'` fail with `PROVIDER_OPERATION_UNSUPPORTED` before an HTTP request is sent.

## Operations

- `listDisputes({ limit })` calls `GET /api/disputes`; the default limit is 100 and the provider caps
  it at Revolut's maximum of 500.
- `retrieveDispute(providerDisputeId)` calls `GET /api/disputes/{dispute_id}`.
- `acceptDispute(providerDisputeId, ctx)` calls `POST /api/disputes/{dispute_id}/accept`. The endpoint
  does not declare `Idempotency-Key`, so Payable does not forward `ctx.idempotencyKey`.

The mapper exposes the dispute id, order id with payment id fallback, state, scheme reason code,
amount, creation time, and response deadline. Accepting a dispute is irreversible and resolves it as
lost.

Evidence upload and challenge are not part of the generic contract. Revolut requires a separate
multipart upload followed by provider-specific challenge reasons and evidence IDs, which is not
equivalent to Stripe's evidence update flow.

---

[Revolut Provider](21-revolut.md) · [Index](../00-index.md)
