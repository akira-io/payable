# Charges and Refunds

Create a one-off charge, then issue a partial or full refund against the local payment record.

## Prerequisites

- A charge-capable and refund-capable provider, such as Stripe
- A configured storage driver
- A billable customer identity

## Configuration

```ts
import { Money } from '@akira-io/payable';

const customer = payable.customer(
  { billableType: 'User', billableId: 'user_42', email: 'jane@example.com' },
  'stripe',
);
```

Money values use minor units, so `Money.of(9900, 'USD')` represents USD 99.00.

## Run the example

```ts
const payment = await customer.charge({
  amount: Money.of(9900, 'USD'),
  reference: 'invoice_42',
  description: 'Annual support package',
});

await payable.refund({
  paymentId: payment.id,
  amount: Money.of(4000, 'USD'),
  reason: 'Unused service',
  reference: 'refund_invoice_42',
});

// Omit amount to refund the remaining balance.
await payable.refund({ paymentId: payment.id });
```

## Expected result

The charge creates a local payment associated with the provider payment ID. The first refund changes
the payment to `partially_refunded`; the second consumes the remaining balance and changes it to
`refunded`.

## Failure behavior

Payable rejects missing payments, non-refundable statuses, currency mismatches, and over-refunds
before sending an invalid request. A failed provider refund releases the reserved balance and marks
the pending refund record as failed. Paddle supports full refunds only. See
[Charges and Refunds](../features/11-charges-refunds.md) for all error codes.

---

[Previous: Subscriptions](37-subscriptions.md) | [Index](../00-index.md) | [Next: Webhooks](39-webhooks-reconciliation.md)
