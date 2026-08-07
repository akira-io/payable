# Advanced Subscription Operations

Use the local subscription resource for administrative billing flows. It resolves the owning
customer and provider binding from storage, keeps the tenant boundary intact, and avoids exposing a
provider subscription ID to application code.

## Prerequisites

- A storage driver and, for preview/apply, an idempotency store
- A tenant-scoped local subscription ID returned by Payable
- A provider whose granular operation descriptor supports the requested policies

```ts
const providerName = 'stripe';
const operations = payable
  .providers()
  .subscriptionOperationCapabilities(providerName);
const subscription = payable.subscription(localSubscriptionId, tenantId);
```

The examples below use the descriptor before presenting an action. The resource repeats the same
validation before any provider request, so a stale or bypassed user interface cannot force an
unsupported operation.

## Immediate upgrade

Preview an immediate upgrade when the subscriber must approve the adjustment before it is applied:

```ts
if (
  operations.changePrice.preview &&
  operations.changePrice.effectiveTimings.includes('immediate') &&
  operations.changePrice.prorationPolicies.includes('prorateImmediately') &&
  operations.changePrice.paymentFailurePolicies.includes('preventChange')
) {
  const preview = await subscription.previewChange({
    priceId: 'price_business',
    effectiveTiming: 'immediate',
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    idempotencyKey: `preview-upgrade-${localSubscriptionId}`,
  });

  await presentPreviewForApproval(preview);

  await subscription.applyChange({
    previewToken: preview.previewToken,
    idempotencyKey: `apply-upgrade-${localSubscriptionId}`,
  });
}
```

The preview token binds the tenant, subscription, current items, proposed items, policies, and
calculation time. It expires after 15 minutes. Applying a stale preview fails with
`SUBSCRIPTION_CHANGE_PREVIEW_STALE`.

## Downgrade at the next renewal

A next-renewal downgrade schedules the replacement without presenting it as the current price:

```ts
if (
  operations.changePrice.preview &&
  operations.changePrice.effectiveTimings.includes('nextRenewal') &&
  operations.changePrice.prorationPolicies.includes('none') &&
  operations.changePrice.paymentFailurePolicies.includes('applyChange')
) {
  const preview = await subscription.previewChange({
    priceId: 'price_starter',
    effectiveTiming: 'nextRenewal',
    prorationPolicy: 'none',
    paymentFailurePolicy: 'applyChange',
    idempotencyKey: `preview-downgrade-${localSubscriptionId}`,
  });

  await presentPreviewForApproval(preview);

  await subscription.applyChange({
    previewToken: preview.previewToken,
    idempotencyKey: `apply-downgrade-${localSubscriptionId}`,
  });
}
```

After a successful apply, `retrieve()` still returns the current historical price until the provider
applies the scheduled change. Webhook reconciliation then updates the effective local items.

## Failed payment behavior

The payment-failure policy is explicit and provider-specific:

- `preventChange` asks the provider to preserve the existing subscription when the immediate payment
  cannot be completed.
- `applyChange` allows the provider to apply the subscription change even when collection needs
  separate recovery.

Only offer a policy listed in `operations.changePrice.paymentFailurePolicies`. If the provider
rejects `applyChange()`, Payable does not mutate the local subscription:

```ts
try {
  await subscription.applyChange({
    previewToken,
    idempotencyKey: `apply-change-${localSubscriptionId}`,
  });
} catch (error) {
  const unchanged = await subscription.retrieve();
  await recordBillingFailure(error, unchanged);
}
```

A provider webhook remains authoritative if the remote system applied a state transition before its
request failed. Process reconciliation before deciding whether to retry.

## Pause and resume

Lifecycle pause and payment-collection pause are different contracts. Use lifecycle pause when the
provider changes the subscription state:

```ts
if (operations.pause.subscription.effectiveTimings.includes('nextRenewal')) {
  await subscription.pauseSubscription({
    effectiveTiming: 'nextRenewal',
    resumeAt: new Date('2027-01-15T00:00:00Z'),
    resumeBillingPolicy: 'startNewBillingPeriod',
  });
}

if (operations.resume.pausedSubscription.effectiveTimings.includes('immediate')) {
  await subscription.resumePausedSubscription({
    effectiveTiming: 'immediate',
    billingPolicy: 'continueExistingBillingPeriod',
  });
}
```

Use payment-collection pause when invoices continue while collection behavior changes:

```ts
if (operations.pause.paymentCollection.behaviors.includes('keepAsDraft')) {
  await subscription.pausePaymentCollection({
    behavior: 'keepAsDraft',
    resumesAt: null,
  });
}

if (operations.resume.paymentCollection) {
  await subscription.resumePaymentCollection();
}
```

## Unsupported operations

Do not infer support from the provider name or from the coarse `subscriptions` capability. Use the
granular descriptor to hide or disable unavailable actions:

```ts
const canPauseImmediately =
  operations.pause.subscription.effectiveTimings.includes('immediate');

if (canPauseImmediately) {
  await subscription.pauseSubscription({
    effectiveTiming: 'immediate',
    resumeAt: null,
    resumeBillingPolicy: 'startNewBillingPeriod',
  });
}
```

Calling an unavailable operation still fails before a provider request with
`ProviderCapabilityNotSupportedError` and code `PROVIDER_CAPABILITY_NOT_SUPPORTED`. This fail-fast
boundary is required for headless, API, and delayed-job callers that do not use the same interface.

## Price migration rule

Archiving a price, creating a replacement, or changing the catalog default does not alter existing
subscriptions. A subscriber keeps the historical price until an explicit provider-confirmed
migration succeeds. See [Subscriptions](../features/10-subscriptions.md#historical-prices-and-explicit-migration)
for identity, audit, and reconciliation details.

---

[Previous: Custom Domain Audit](46-custom-domain-audit.md) | [Index](../00-index.md)
