# Canonical Subscription Price Migrations

Status: approved design

Date: 2026-08-25

Tracking:

- Payable: new canonical migration tracking epic and delivery issues
- Bu Payment API: #155, followed by #156
- Bu Payment web: #67

## Purpose

Existing subscriptions must remain bound to their historical price until an explicit,
approved migration succeeds. The migration contract must be reusable by any billing
application that embeds Payable. Bu Payment may orchestrate operators, workspaces, bulk
selection, and notifications, but it must not become a second billing engine.

## Architectural rule

Payable is a provider-neutral and host-neutral billing middle layer. It owns every
reusable billing concept, calculation, capability, lifecycle, and persistence contract.
It must not contain Bu Payment organisation, workspace, dashboard, or commercial-policy
assumptions.

Bu Payment API owns only host context and orchestration:

- organisation, workspace, and environment authorization;
- operator selection and approval;
- grouping canonical migrations into resumable batches;
- job execution and dashboard projections;
- customer communication policy in API #156.

Provider-specific price-change behavior remains behind Payable provider capabilities.
The API must never calculate proration, infer provider defaults, or persist a competing
single-subscription migration lifecycle.

## Goals

- Create immutable, provider-neutral migration previews.
- Support immediate, next-renewal, and explicitly dated execution.
- Require explicit proration and payment-failure policies.
- Persist a canonical lifecycle for one subscription migration.
- Preserve the historical subscription price until confirmed success.
- Make retries, ambiguous outcomes, cancellation, and reconciliation safe.
- Let host applications build resumable bulk orchestration without duplicating billing
  behavior.
- Keep existing Payable subscription change APIs compatible by delegating to the new
  canonical resource.

## Non-goals

- Jurisdiction-specific customer notice rules.
- Email, SMS, or webhook delivery orchestration.
- Bu Payment dashboard screens.
- Provider-specific request shapes in public Payable contracts.
- A Payable-level bulk selector tied to host application queries.

## Payable canonical resource

Payable adds `SubscriptionPriceMigration`, scoped by `tenantId` and identified by an
immutable local ID.

The resource records:

- `subscriptionId`;
- `sourcePriceId` and `targetPriceId`;
- immutable source and target price snapshots;
- current and proposed subscription item snapshots;
- `effectiveTiming` and conditional `effectiveAt`;
- `prorationPolicy` and `paymentFailurePolicy`;
- provider-neutral immediate adjustment and next-renewal summaries;
- `previewToken`, request hash, `calculatedAt`, and `expiresAt`;
- status, attempt count, stable failure code, and timestamps;
- provider binding used for the operation without exposing credentials.

Price snapshots contain the canonical values needed to explain an approved change:
amount, currency, recurring interval and count, product ID, and price ID. They do not
store provider display payloads.

### Effective timing contract

The timing input is a discriminated union:

- `immediate`;
- `nextRenewal`;
- `scheduled` with mandatory RFC 3339 `effectiveAt`.

Providers that cannot honor an explicitly dated migration return the stable capability
error before a migration is approved.

### Lifecycle

Public states are:

- `previewed`;
- `scheduled`;
- `executing`;
- `applied`;
- `failed`;
- `reconciliation_required`;
- `cancelled`.

Allowed transitions are:

```text
previewed -> scheduled | executing | cancelled
scheduled -> executing | cancelled
executing -> applied | failed | reconciliation_required
failed -> executing | cancelled
```

`applied`, `reconciliation_required`, and `cancelled` are terminal for automatic
execution. Reconciliation requires an explicit operator or host action. A fresh preview
is required after expiry or after a material subscription or price change.

### Eligibility

Payable validates against canonical resources before persisting approval:

- subscription, source price, and target price belong to the same tenant;
- the subscription is still bound to the expected source price;
- the target price is active;
- source and target belong to the same canonical product;
- currency and billing interval changes satisfy the selected provider capability and
  policy;
- requested timing and policies are explicitly supported;
- the subscription state permits the operation.

No provider ID, lookup key, name, or display value may substitute for a canonical ID.

## Preview and execution flow

1. A host requests a preview with canonical subscription and target price IDs plus
   explicit timing and policies.
2. Payable resolves canonical state and provider capabilities.
3. The provider adapter supplies the financial preview when supported. A documented
   provider-neutral local calculation may be used only when its capability explicitly
   declares that behavior.
4. Payable persists the immutable preview and returns the canonical migration resource.
5. Approval schedules or starts that same migration ID. The approved preview cannot be
   replaced by a new implicit calculation.
6. Immediately before an external provider mutation, Payable acquires the migration
   execution claim with compare-and-swap.
7. Payable applies the provider operation, updates the canonical subscription only after
   confirmed success, and emits audit and outbox events in the same local transaction.
8. A provider timeout or post-provider persistence uncertainty becomes
   `reconciliation_required`; it is never retried automatically.

## Idempotency and concurrency

Preview, approval, execution, cancellation, and retry use operation-specific durable
idempotency keys. The request hash includes subscription, prices, timing, effective date,
and both policies.

Execution uses an ownership token and compare-and-swap state transition. Only the owner
may complete or fail the attempt. Preparation failures release the claim. Once provider
execution starts, ambiguous failures retain a durable non-retryable state.

Concurrent attempts for the same migration cannot call the provider twice. Concurrent
migrations for the same subscription are rejected unless the first is terminal and the
subscription still matches the new preview source state.

## Storage and drivers

The resource is part of the public storage contract and must be implemented consistently
for Knex and Prisma. Migrations are additive and replay-safe. Provider bindings and
canonical resource relations remain tenant-qualified.

Indexes support:

- retrieve by tenant and migration ID;
- bounded pages by tenant and status;
- pages by canonical subscription ID;
- due scheduled migrations ordered by effective date and ID;
- prevention of multiple active migrations for one subscription.

Fresh schemas and beta8 upgrade paths must converge. Prisma schema sync, Knex migration
ledger, storage mappers, generated public types, bundle exports, and consumer smoke tests
must remain aligned.

## Payable public surface

The TypeScript resource provides:

- preview a canonical migration;
- retrieve and page migrations;
- approve for immediate or scheduled execution;
- execute a due migration;
- cancel a cancellable migration;
- retry a recoverable failed migration;
- expose operation capabilities.

Supported Express, Fastify, Nest, and MCP adapters expose equivalent provider-neutral
contracts where canonical subscription operations are already available. HTTP adapters
require bounded payloads, rate limits, authentication hooks, tenant resolution, and
idempotency keys.

Existing `subscription(...).previewChange()` and `applyChange()` remain source compatible.
They delegate to the canonical migration resource and return their established DTOs.

Stable errors include:

- `SUBSCRIPTION_MIGRATION_PREVIEW_STALE`;
- `SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE`;
- `PROVIDER_CAPABILITY_NOT_SUPPORTED`;
- `SUBSCRIPTION_MIGRATION_STATE_CONFLICT`;
- `SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED`.

## Bu Payment API orchestration

The API adds `PriceMigrationBatch` and `PriceMigrationBatchItem`. A batch is scoped by
organisation, workspace, and environment. Each item references exactly one canonical
Payable migration ID.

The API may select subscriptions by a bounded explicit ID list or a source price filter.
It returns aggregated preview totals but retains individual Payable outcomes. Approval
responds asynchronously and workers process only pending or recoverable failed items.
Applied items are never retried.

The API does not persist its own proration result or single-migration state as authority.
Its batch item is a projection of the referenced Payable resource. It may cache display
data for the dashboard, but reconciliation always reads the canonical Payable state.

API #156 attaches notification policy and delivery state to the batch and its items. It
consumes Payable lifecycle events. It does not alter Payable calculations or provider
routing.

## Development dependency flow

All repositories are still development lines. Payable `main` is the integration source
and tags are created only when a release is ready.

During development:

- Payable PRs merge to `main` normally;
- Bu Payment API declares `github:akira-io/payable#main`;
- `bun.lock` resolves and records the exact Payable commit;
- CI installs with `bun install --frozen-lockfile`;
- advancing Payable requires an explicit dependency update and lockfile diff;
- Payable provides a `prepare` build so a Git dependency contains its generated `dist`;
- a consumer smoke test installs Payable from a Git commit and verifies ESM, CJS, types,
  subpaths, binaries, and Prisma schema tooling.

When the complete migration and notification phase is approved, the same Payable history
is tagged as `v1.0.0-beta9`. The API then replaces the Git dependency with the exact npm
version and regenerates its lockfile. No intermediate npm dev release is required.

## Verification strategy

Payable focused tests cover:

- upgrades, downgrades, quantity changes, period changes, and no-proration changes;
- immediate, next-renewal, and explicit scheduled dates;
- active and archived target prices, cross-product and cross-tenant rejection;
- unpaid invoices, payment rejection, provider rejection, and capability gaps;
- preview expiry, changed subscription state, idempotent replay, and conflict hashing;
- concurrent execution, provider timeout, post-provider persistence failure, and
  reconciliation;
- cancellation, retry eligibility, tenant-safe retrieve, and cursor pagination;
- Knex and Prisma fresh and upgrade migrations;
- adapter parity, OpenAPI, MCP, bundle, exports, and Git dependency consumer smoke.

Bu Payment API focused tests cover:

- organisation, workspace, environment, and permission isolation;
- explicit and source-price subscription selection;
- batch preview aggregation without losing per-item values;
- resumable processing and no retry of applied items;
- partial failures, cancellation, concurrency, and canonical reconciliation;
- OpenAPI and dashboard authorization.

Each repository runs one complete suite at its final PR gate. Iteration uses focused tests.

## Delivery sequence

1. Create a Payable tracking epic and atomic child issues for Git-main consumption,
   canonical model/storage, lifecycle execution, adapters, and conformance.
2. Add and verify Git dependency installation from Payable `main`.
3. Implement the canonical Payable migration model and storage.
4. Implement preview, approval, scheduling, execution, cancellation, and reconciliation.
5. Expose adapter parity and complete Payable conformance gates.
6. Merge Payable PRs to `main` after their normal review and authorization.
7. Update Bu Payment API to the resolved Payable `main` commit and implement #155 batch
   orchestration.
8. Implement API #156 notification and audit controls.
9. Implement web #67 against the finalized API contracts.
10. After explicit release authorization, tag Payable beta9 and replace the API Git
    dependency with the exact npm beta.
