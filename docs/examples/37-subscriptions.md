# Subscription Lifecycle

Create and manage a stored subscription through the fluent customer API.

## Prerequisites

- A provider with direct subscription and subscription-management capabilities, such as Stripe
- A configured storage driver
- Provider price IDs for the plans offered by the application

## Configuration

```ts
const billable = {
  billableType: 'Team',
  billableId: 'team_42',
  email: 'owner@example.com',
};

const customer = payable.customer(billable, 'stripe');
```

The local subscription name identifies the subscription within the billable customer. Use a stable
name such as `default` or `workspace`.

## Run the example

```ts
const subscription = await customer
  .newSubscription('default')
  .price('price_pro_monthly')
  .quantity(3)
  .trialDays(14)
  .create();

const manager = customer.subscription('default');

const preview = await manager.previewChange({
  priceId: 'price_business_monthly',
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
  idempotencyKey: 'preview-team-42-business',
});
await manager.applyChange({
  previewToken: preview.previewToken,
  idempotencyKey: 'apply-team-42-business',
});

await manager.updateQuantity({
  quantity: 5,
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
});
await manager.cancel();
await manager.resume();

const current = await manager.get();
```

For an administrative workflow, keep the local ID returned by Payable and open the subscription
resource directly:

```ts
const subscription = payable.subscription(localSubscriptionId, tenantId);

await subscription.swap({
  priceId: 'price_business_monthly',
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
});
await subscription.updateQuantity({
  quantity: 5,
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
});
await subscription.cancel();

const current = await subscription.retrieve();
```

This resource resolves the customer and provider binding from storage. It routes mutations through
the provider stored on the subscription and returns the refreshed local record. Pass `tenantId`
whenever tenancy is enabled. Provider subscription IDs remain adapter details.

Use `.checkout(...)` instead of `.create()` when the provider requires a hosted checkout page.

## Expected result

Payable persists the provider subscription ID, status, price, quantity, period dates, and items. Each
management operation updates the provider first and then reconciles the local subscription.

## Failure behavior

Direct creation fails when the selected provider does not implement the direct-subscription
capability. Preview and apply also require an idempotency store. Management fails without storage or
when the named subscription does not exist. Paddle subscriptions must begin through hosted checkout.
See [Subscriptions](../features/10-subscriptions.md) for provider capability and state details.

For provider-gated upgrade, downgrade, failed-payment, pause, and resume flows, continue with
[Advanced Subscription Operations](47-subscription-operations.md).

---

[Previous: Multiple Providers](36-multi-provider.md) | [Index](../00-index.md) | [Next: Charges and Refunds](38-charges-refunds.md)
