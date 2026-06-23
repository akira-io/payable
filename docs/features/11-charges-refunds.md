# Charges and Refunds

A **charge** is a one-off payment against a customer; a **refund** returns money against a recorded
payment, partially or in full. Both persist locally and track the payment's lifecycle through the
payment state machine.

## One-off charge

`payable.customer(billable).charge(request)` runs `ChargeAction`. The request is a `ChargeRequest`:

```ts
export interface ChargeRequest {
  amount: Money;
  reference?: string;
  description?: string;
}
```

`amount` is a `Money` value object in minor units (see [06-value-objects.md](../domain/06-value-objects.md)).

```ts
import { Money } from '@akira-io/payable';

const payment = await payable.customer(billable).charge({
  amount: Money.of(9900, 'USD'),
  reference: 'inv_1',
  description: 'one-time',
});
```

`ChargeAction.handle`:

1. Requires the provider to be **charge capable** (`isChargeCapable`, i.e. it implements `charge`);
   otherwise throws `ProviderCapabilityNotSupportedError`.
2. Requires a storage driver (`PAYMENT_STORAGE_REQUIRED`).
3. Syncs the customer to the provider and loads the local customer row; throws `CustomerNotFoundError`
   if missing.
4. Builds a deterministic key with `IdempotencyKey.forCharge` keyed by provider, billable,
   `reference`, amount, and currency - for example `charge:stripe:User:1:inv_1:9900:USD`.
5. Calls `provider.charge({ providerCustomerId, amount, reference, description }, ctx)`.
6. Persists a `payments` row with `status`, `currency`, `amount`, `refundedAmount: 0`, and the
   `reference`/`description`.

Output: the persisted `Payment` entity.

```mermaid
sequenceDiagram
    participant App
    participant Action as ChargeAction
    participant Sync as SyncCustomerWithProviderAction
    participant Provider
    participant Storage
    App->>Action: charge({ amount, reference, description })
    Action->>Action: assert charge-capable + storage
    Action->>Sync: handle(billable)
    Sync-->>Action: providerCustomerId
    Action->>Storage: customers.findByBillable
    Storage-->>Action: customer (or CustomerNotFoundError)
    Action->>Provider: charge(input, ctx)
    Provider-->>Action: ChargeResultDTO
    Action->>Storage: payments.create(...)
    Storage-->>App: Payment
```

The provider returns a `ChargeResultDTO`: `{ providerPaymentId, status, amount }`.

## Refund

`payable.refund(request)` runs `RefundPaymentAction`. The request is `RefundRequest`:

```ts
export interface RefundRequest {
  paymentId: string;
  amount?: Money;
  reason?: string;
}
```

`paymentId` is the **local** payment id. Omit `amount` for a full refund; pass a `Money` for a partial
refund.

```ts
// full refund
await payable.refund({ paymentId: payment.id });

// partial refund
await payable.refund({ paymentId: payment.id, amount: Money.of(4000, 'USD') });
```

`RefundPaymentAction.handle`:

1. Requires a storage driver (`PAYMENT_STORAGE_REQUIRED`).
2. Loads the payment by id; throws `PayableError` (`PAYMENT_NOT_FOUND`) if it is missing or has no
   `providerPaymentId`.
3. Asserts the provider's `refunds` capability via `assertProviderCapability`.
4. Builds a deterministic key with `IdempotencyKey.forRefund` keyed by provider, provider payment id,
   amount (defaulting to the full payment amount), and currency.
5. Calls `provider.refund({ providerPaymentId, amount, reason }, ctx)`.
6. Rejects a currency mismatch: if the refund DTO currency differs from the payment currency, throws
   `PayableError` (`REFUND_CURRENCY_MISMATCH`).
7. Persists a `refunds` row.
8. Recomputes `refundedAmount = payment.refundedAmount + dto.amount`. Using `PaymentStateMachine`, it
   transitions the payment to **refunded** when `refundedAmount >= payment.amount`, otherwise to
   **partially refunded**; then updates the payment's `refundedAmount` and `status`.

Output: the persisted `Refund` entity.

### Partial vs full refund

Refunds accumulate. Charging 9900 then refunding 4000 leaves the payment `partially_refunded` with
`refundedAmount` = 4000; a further refund of 5900 makes the status `refunded` with `refundedAmount`
= 9900. The full/partial decision is purely `refundedAmount` vs `payment.amount` - there is no separate
"full refund" flag.

```mermaid
flowchart TD
    A[refund request] --> B{payment found?}
    B -- no --> E[PAYMENT_NOT_FOUND]
    B -- yes --> C{provider refunds capable?}
    C -- no --> F[ProviderCapabilityNotSupportedError]
    C -- yes --> D[provider.refund]
    D --> G{currency matches payment?}
    G -- no --> H[REFUND_CURRENCY_MISMATCH]
    G -- yes --> I[persist refund]
    I --> J{refundedAmount >= payment.amount?}
    J -- yes --> K[status = refunded]
    J -- no --> L[status = partially_refunded]
```

## Policies

`CanRefundPaymentPolicy`, `CanCreateCheckoutPolicy`, and `CanCreateSubscriptionPolicy` all authorize
against an `AuthorizationContext`: `isAuthorized` returns `true` only when `allowed === true` and
`actorId` is a non-empty string.

These policies are **defined but not yet wired** into `ChargeAction`, `RefundPaymentAction`, or the
checkout pipeline - none of the actions or pipelines reference them, and only `CanReplayWebhookPolicy`
is consumed (by `ReplayWebhookAction`). They are reusable authorization helpers for integrators to call
in their own controllers; today the charge and refund paths perform no actor-level authorization of
their own.

## Edge cases

- **No storage driver.** Charge and refund both throw `PAYMENT_STORAGE_REQUIRED`.
- **Provider not charge capable.** `ChargeAction` throws `ProviderCapabilityNotSupportedError`.
- **Provider lacks `refunds` capability.** `RefundPaymentAction` throws via `assertProviderCapability`.
- **Unknown payment id / no provider payment id.** `PAYMENT_NOT_FOUND`.
- **Refund currency differs from payment.** `REFUND_CURRENCY_MISMATCH`.
- **Refund exceeding the remaining balance.** Not blocked by a dedicated guard in this version: the
  action forwards `amount` to the provider and, after persisting, marks the payment `refunded` once
  `refundedAmount >= payment.amount`. Enforcement of an over-refund relies on the provider rejecting
  it; there is no local "already fully refunded" precheck.

---

[Previous: Subscriptions](10-subscriptions.md) · [Index](../00-index.md) · [Next: Invoices and Portal](12-invoices-portal.md)
