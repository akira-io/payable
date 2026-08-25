# Canonical Subscription Price Migrations

Status: approved design

Date: 2026-08-25

## Purpose

Existing subscriptions must remain bound to their historical price until an explicit,
approved migration succeeds. The migration contract must be reusable by any billing
application that embeds Payable. A host may orchestrate operators, scopes, bulk selection,
and notifications, but it must not become a second billing engine.

## Architectural rule

Payable is a provider-neutral and host-neutral billing middle layer. It owns every
reusable billing concept, calculation, capability, lifecycle, and persistence contract.
It must not contain host-specific organisation, workspace, dashboard, or commercial-policy
assumptions.

A host application owns only its context and orchestration:

- organisation, workspace, and environment authorization;
- operator selection and approval;
- grouping canonical migrations into resumable batches;
- job execution and dashboard projections;
- customer communication policy.

Provider-specific price-change behavior remains behind Payable provider capabilities.
The host must never calculate proration, infer provider defaults, or persist a competing
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
- Host dashboard screens.
- Provider-specific request shapes in public Payable contracts.
- A Payable-level bulk selector tied to host application queries.

## Payable canonical resource

Payable adds `SubscriptionPriceMigration`, scoped by `tenantId` and identified by an
immutable local ID.

The resource records:

- `subscriptionId`;
- stable `primaryItemId`, so duplicate source-price items cannot change the top-level snapshot;
- `sourcePriceId` and `targetPriceId`;
- immutable source and target price snapshots;
- current and proposed subscription item snapshots;
- `effectiveTiming` and conditional `effectiveAt`;
- `prorationPolicy` and `paymentFailurePolicy`;
- provider-neutral immediate adjustment and next-renewal summaries;
- `previewToken`, request hash, `calculatedAt`, and `expiresAt`;
- status, attempt count, stable failure code, and timestamps;
- provider-neutral reconciliation outcome and host evidence reference after explicit resolution;
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

`nextRenewal` additionally requires a non-null, valid canonical `currentPeriodEnd`. Payable rejects
the preview before persistence or provider work when that immutable boundary is unavailable.

### Lifecycle

Public states are:

- `previewed`;
- `scheduled`;
- `executing`;
- `pending_renewal`;
- `applied`;
- `failed`;
- `reconciliation_required`;
- `cancelled`.

Allowed transitions are:

```text
previewed -> scheduled | executing | cancelled
scheduled -> executing | cancelled
executing -> applied | pending_renewal | failed | reconciliation_required
pending_renewal -> applied (explicit boundary settlement only)
failed -> executing | cancelled
reconciliation_required -> applied | pending_renewal | failed (explicit resolution only)
```

`applied` and `cancelled` are terminal. `reconciliation_required` permits only explicit
operator resolution, and `pending_renewal` permits only explicit settlement at or after the
immutable renewal date. A fresh preview is required after expiry or after a material subscription
or price change.

### Eligibility

Payable validates against canonical resources before persisting approval:

- subscription, source price, and target price belong to the same tenant;
- the subscription is still bound to the expected source price;
- the target price is active when it differs from the historical source; an archived historical
  source remains valid for a quantity-only change;
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
6. Payable revalidates canonical items, renewal boundary, binding, and capabilities; only then
   does it acquire the migration execution claim with compare-and-swap.
7. Payable applies the provider operation. Immediate success projects canonical state. A confirmed
   next-renewal instruction records `pending_renewal`, preserves the historical local price, and
   keeps both fences until a trusted host settles it at or after the immutable renewal date without
   another provider call.
8. A provider timeout or post-provider persistence uncertainty becomes
   `reconciliation_required`; it is never retried automatically.

## Idempotency and concurrency

Preview, approval, execution, settlement, cancellation, retry, and reconciliation resolution use
operation-specific durable idempotency keys. The request hash includes subscription, prices, timing, effective date,
and both policies.

Execution uses an ownership token and compare-and-swap state transition. A separate durable
tenant-and-subscription mutation claim is shared with every existing-subscription provider mutation,
including cancel, pause, resume, scheduled-change cancellation, swap, quantity, and legacy apply,
so two provider mutations cannot overlap even when their initial reads race. Only the owner may complete
or fail the attempt. Preparation failures roll back the claim. Confirmed safe outcomes release it;
ambiguous outcomes retain it.

Concurrent attempts for the same migration cannot call the provider twice. Concurrent migrations
for the same subscription are rejected while the first holds its active fence. Both
`reconciliation_required` and `pending_renewal` retain that fence and block new migrations and
direct subscription mutations until explicit resolution or settlement.

## Storage and drivers

The resource is part of the public storage contract and must be implemented consistently
for Knex and Prisma. Migrations are additive and replay-safe. Provider bindings and
canonical resource relations remain tenant-qualified.

Custom storage drivers must implement the complete `SubscriptionPriceMigrationRepository`, including
`createWithExecutionEvidence(...)`, `findExecutionEvidenceById(...)`,
`findActiveBySubscriptionId(...)`, and `resolveReconciliation(...)`. Evidence crosses this public
storage boundary only as `SubscriptionPriceMigrationExecutionEvidenceBlob`, an opaque branded
string. Raw provider fields and codecs remain internal. Drivers must also implement
`SubscriptionMutationClaimRepository` with a database-enforced unique tenant/subscription key and
exact owner-token acquire/release, tenant-scoped active lookup, unknown-outcome observation,
lookup-by-reference, and idempotent resolution. Its stored intent is an opaque
`SubscriptionMutationIntentBlob`; ordinary claim views never expose it. Persistent drivers
rehydrate the two blobs with their public version-validating factories, which validate
the opaque format version without exposing its provider-native payload. These are required,
type-safe contract additions, not optional runtime capabilities.

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
- settle a provider-confirmed `pending_renewal` migration at its immutable boundary without a
  second provider call;
- cancel a cancellable migration;
- retry a recoverable failed migration;
- resolve a retained `executing` or `reconciliation_required` owner as operator-confirmed `applied`,
  `not_applied`, or `unknown`, with a durable
  idempotency key and evidence reference, without another provider call;
- expose operation capabilities.

Supported Express, Fastify, Nest, and MCP adapters expose equivalent provider-neutral
contracts where canonical subscription operations are already available. HTTP adapters
require bounded payloads, rate limits, authentication hooks, tenant resolution, and
idempotency keys.

Reconciliation resolution is intentionally a TypeScript resource operation in this version. No
generic HTTP or MCP route is exposed: a host must first establish ownership and verify provider
state, then call `resolve()` from its trusted operator workflow. `applied` projects the immutable
approved change immediately or records `pending_renewal` for a next-renewal operation;
`not_applied` becomes retryable `failed`; `unknown` moves a retained `executing` owner to
`reconciliation_required` without releasing it. Exact repeats replay and conflicting resolutions fail.

Ambiguous direct subscription mutations return a safe claim reference and retain the shared
fence. A trusted host uses `payable.subscriptionMutationClaims(tenantId)` to retrieve that
provider-neutral claim and resolve it as `applied`, `not_applied`, or `unknown`, with an idempotency
key and evidence reference. Resolution never calls the provider: for swap and quantity claims,
`applied` performs only the stored canonical projection; for lifecycle claims whose exact returned
state cannot be inferred, it confirms and releases without fabricating local fields, leaving exact
state mirroring to the host's verified provider sync or webhook path. `not_applied` releases without
projection, and `unknown` retains the fence and records the observation. If a webhook already
projected exactly a stored swap or quantity target, `applied` is an idempotent no-op; any third local
state conflicts.

Existing `subscription(...).previewChange()` and `applyChange()` remain source compatible.
They delegate to the canonical migration resource and return their established DTOs.

Stable errors include:

- `SUBSCRIPTION_MIGRATION_PREVIEW_STALE`;
- `SUBSCRIPTION_MIGRATION_TARGET_INELIGIBLE`;
- `PROVIDER_CAPABILITY_NOT_SUPPORTED`;
- `SUBSCRIPTION_MIGRATION_STATE_CONFLICT`;
- `SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED`;
- `SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED`;
- `SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED`;
- `SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED` (with safe claim reference and correlation ID).

## Host orchestration

A host may add batch and batch-item projections scoped by its own authorization model. Each item
references exactly one canonical Payable migration ID. The host may select subscriptions by a
bounded explicit ID list or a source-price filter and aggregate preview totals without losing
individual Payable outcomes. Workers process only pending or recoverable failed items; applied
items are never retried.

The host does not persist its own proration result or single-migration state as authority. Its
batch item remains a projection of the referenced Payable resource. Host notification and delivery
state may consume Payable lifecycle events, but it does not alter Payable calculations or provider
routing.

## Development dependency flow

Payable `main` is the development integration source. Tags and packages are created later only
through a separately authorized release process.

During development:

- Payable changes merge to `main` through the normal review process;
- a development consumer declares `github:akira-io/payable#main`;
- `bun.lock` resolves and records the exact Payable commit;
- CI installs with `bun install --frozen-lockfile`;
- advancing Payable requires an explicit dependency update and lockfile diff;
- Payable provides a `prepare` build so a Git dependency contains its generated `dist`;
- a consumer smoke test installs Payable from a Git commit and verifies ESM, CJS, types,
  subpaths, binaries, and Prisma schema tooling.

Installing `main` is not a release request. No tag, package version, publication, or downstream
dependency replacement is implied; those actions happen later only with explicit authorization.

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

Each repository runs one complete suite at its final PR gate. Iteration uses focused tests.

## Delivery sequence

1. Verify Git dependency installation from Payable `main`.
2. Implement the canonical migration model and storage.
3. Implement preview, approval, scheduling, execution, cancellation, and reconciliation.
4. Expose adapter parity and complete Payable conformance gates.
5. Merge through the normal review and authorization process.
6. Let hosts build batch, notification, and dashboard projections against the provider-neutral
   resource.
7. Create tags or publications later only through an explicitly authorized release process.
