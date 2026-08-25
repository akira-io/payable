# Advanced Subscription Operations

Use the local subscription resource for administrative billing flows. It resolves the owning
customer and provider binding from storage, keeps the tenant boundary intact, and avoids exposing a
provider subscription ID to application code.

## Prerequisites

- A storage driver and, for preview/apply, an idempotency store
- A tenant-scoped canonical subscription, item, and target price ID returned by Payable
- A provider whose granular operation descriptor supports the requested policies

```ts
const providerName = 'stripe';
const operations = payable
  .providers()
  .subscriptionOperationCapabilities(providerName);
const subscription = payable.subscription(localSubscriptionId, tenantId);
const migrations = payable.subscriptionPriceMigrations(tenantId);
```

The examples below use the descriptor before presenting an action. The resource repeats the same
validation before any provider request, so a stale or bypassed user interface cannot force an
unsupported operation.

## Canonical migration lifecycle

New price migration flows use `subscriptionPriceMigrations(tenantId)`. The resource accepts
canonical Payable IDs, persists the financial preview, and uses the returned migration ID for every
later operation. It does not accept a provider subscription or price identifier.

## Immediate upgrade

Preview an immediate upgrade when the subscriber must approve the adjustment before it is applied:

```ts
if (
  operations.changePrice.preview &&
  operations.changePrice.effectiveTimings.includes('immediate') &&
  operations.changePrice.prorationPolicies.includes('prorateImmediately') &&
  operations.changePrice.paymentFailurePolicies.includes('preventChange')
) {
  const preview = await migrations.preview({
    subscriptionId: canonicalSubscriptionId,
    targetPriceId: canonicalBusinessPriceId,
    itemId: canonicalSubscriptionItemId,
    timing: { effectiveTiming: 'immediate' },
    prorationPolicy: 'prorateImmediately',
    paymentFailurePolicy: 'preventChange',
    idempotencyKey: `preview-upgrade-${canonicalSubscriptionId}-v1`,
  });

  await presentPreviewForApproval(preview);

  await migrations.approve(preview.id, {
    idempotencyKey: `approve-upgrade-${preview.id}-v1`,
  });
}
```

The migration binds the tenant, subscription, current items, proposed items, policies, provider
binding, renewal boundary, and calculation time. It expires after 15 minutes. Approving a stale
preview fails with `SUBSCRIPTION_MIGRATION_PREVIEW_STALE`.

## Downgrade at the next renewal

A next-renewal downgrade schedules the replacement without presenting it as the current price:

```ts
if (
  operations.changePrice.preview &&
  operations.changePrice.effectiveTimings.includes('nextRenewal') &&
  operations.changePrice.prorationPolicies.includes('none') &&
  operations.changePrice.paymentFailurePolicies.includes('applyChange')
) {
  const preview = await migrations.preview({
    subscriptionId: canonicalSubscriptionId,
    targetPriceId: canonicalStarterPriceId,
    itemId: canonicalSubscriptionItemId,
    timing: { effectiveTiming: 'nextRenewal' },
    prorationPolicy: 'none',
    paymentFailurePolicy: 'applyChange',
    idempotencyKey: `preview-downgrade-${canonicalSubscriptionId}-v1`,
  });

  await presentPreviewForApproval(preview);

  await migrations.approve(preview.id, {
    idempotencyKey: `approve-downgrade-${preview.id}-v1`,
  });
}
```

Approval submits the next-renewal instruction to the provider and records the accepted migration as
`pending_renewal`. The canonical subscription item still carries its historical local price and the
active fence remains held. At or after `preview.currentRenewalDate`, a trusted host settles it without
another provider call:

```ts
await migrations.settle(preview.id, {
  idempotencyKey: `settle-downgrade-${preview.id}-v1`,
});
```

A webhook may advance lifecycle dates, but it never independently infers this local price change.

## Scheduled migration

`scheduled` always carries an explicit instant. The core API uses a `Date`; HTTP and MCP inputs use
the equivalent RFC 3339 string.

```ts
const preview = await migrations.preview({
  subscriptionId: canonicalSubscriptionId,
  targetPriceId: canonicalBusinessPriceId,
  itemId: canonicalSubscriptionItemId,
  timing: {
    effectiveTiming: 'scheduled',
    effectiveAt: new Date('2026-10-01T09:00:00.000Z'),
  },
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
  idempotencyKey: `preview-scheduled-${canonicalSubscriptionId}-v1`,
});

await migrations.approve(preview.id, {
  idempotencyKey: `approve-scheduled-${preview.id}-v1`,
});
```

Approval records `scheduled` and makes no provider call. A worker reads due pages from
`migrations.due(...)` and invokes `migrations.execute(...)` with its own durable idempotency key.

## Failed payment behavior

The payment-failure policy is explicit and provider-specific:

- `preventChange` asks the provider to preserve the existing subscription when the immediate payment
  cannot be completed.
- `applyChange` allows the provider to apply the subscription change even when collection needs
  separate recovery.

Only offer a policy listed in `operations.changePrice.paymentFailurePolicies`. If a provider returns
a confirmed no-side-effect failure, Payable does not mutate the local subscription:

```ts
try {
  await migrations.approve(canonicalMigrationId, {
    idempotencyKey: `approve-change-${canonicalMigrationId}-v1`,
  });
} catch (error) {
  const unchanged = await subscription.retrieve();
  await recordBillingFailure(error, unchanged);
}
```

A provider webhook remains authoritative if the remote system applied a state transition before its
request failed. Process reconciliation before deciding whether to retry.

## Ambiguous reconciliation

A timeout, thrown provider error, malformed outcome, or local persistence failure after a provider
mutation moves the migration to `reconciliation_required`. The retained execution token prevents an
automatic second provider call. Read the provider state, compare it with the immutable canonical
migration, and complete an explicit operator reconciliation. Do not call `retry()` for this state.

A host crash after durable claim acquisition can leave the migration in `executing` before any
provider call. The same trusted TypeScript workflow resolves that retained owner: `unknown` records
the observation and moves it to `reconciliation_required`, while conclusive `not_applied` or
`applied` completes it without making a provider request.

After a trusted host workflow establishes the remote outcome, resolve it without another provider
call:

```ts
await migrations.resolve(canonicalMigrationId, {
  outcome: 'applied',
  evidenceReference: 'operator-case-2026-08-25-0042',
  idempotencyKey: `resolve-change-${canonicalMigrationId}-v1`,
});
```

Use `not_applied` only when the host has confirmed no remote application. It transitions to
retryable `failed` and releases the durable claim. Immediate `applied` also releases it; a
next-renewal `applied` becomes `pending_renewal` and retains it until `settle()`. Exact repeats replay
and conflicting resolutions fail.

If any existing-subscription provider mutation throws
`SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED`, preserve its safe `context.claimReference`; do not
blindly retry. A trusted host can inspect and resolve the provider-neutral claim without a provider
call:

```ts
await payable.subscriptionMutationClaims(tenantId).resolve(claimReference, {
  outcome: providerStateIsConclusive ? 'applied' : 'unknown',
  evidenceReference: operatorEvidenceReference,
  idempotencyKey: `resolve-direct-${claimReference}-v1`,
});
```

`unknown` keeps the claim active. `not_applied` safely releases it. For swap and quantity claims,
`applied` projects the stored item intent exactly once and releases it. Cancel, pause, resume,
scheduled-cancellation, and legacy-apply claims do not contain enough provider-returned state to
fabricate a local lifecycle projection: `applied` confirms and releases those claims, while the host
uses its verified provider sync or webhook path to mirror the exact provider state.

Only `failed` migrations are retryable, and each retry requires a new operation key.

Currency and billing-period changes are separately capability-gated. Both default to unsupported;
offer them only when `operations.changePrice.supportsCurrencyChange` or
`operations.changePrice.supportsBillingPeriodChange` is explicitly `true`.

## Legacy API compatibility

`subscription(...).previewChange()` and `applyChange()` keep their existing signatures and DTOs.
Canonical subscriptions delegate those calls to the canonical migration resource. Preview tokens
stored before migration step 021 and historical provider-native subscriptions remain readable; the
compatibility path never fabricates canonical catalog IDs.

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
