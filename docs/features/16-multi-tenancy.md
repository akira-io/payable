# Multi-Tenancy

Payable can isolate every persisted record by tenant, so one Payable instance can serve many
customers of the integrating application (an "agency hosting many merchants" shape) without their
data mixing. Tenancy is **off by default**; when enabled, a tenant id is required on tenant-scoped
operations and is threaded through customers, payments, and webhooks down to the storage layer.

## Configuration

`TenantConfig` on `PayableConfig` (`src/support/config/payable-config.ts`):

```ts
export interface TenantConfig {
  enabled: boolean;
  resolver?: TenantResolver;
}
```

`resolveConfig` resolves it to:

```ts
tenantEnabled: config.tenant?.enabled ?? false,
tenantResolver: config.tenant?.resolver,
```

So with no `tenant` block, `tenantEnabled` is `false` and tenancy is disabled.

## The `TenantResolver` contract

`src/domain/contracts/tenant-resolver.contract.ts` lets the integrator derive a tenant id from an
incoming webhook request:

```ts
export interface TenantResolutionContext {
  provider: string;
  headers: Record<string, string>;
  payload: string;
}

export interface TenantResolver {
  resolve(context: TenantResolutionContext): string | null | Promise<string | null>;
}
```

A resolver inspects the provider name, request headers, or raw payload and returns a tenant id (or
`null`). A header-based resolver is the simplest form:

```ts
const headerResolver: TenantResolver = {
  resolve: (context) => context.headers['x-tenant-id'] ?? null,
};
```

The resolver may be synchronous or asynchronous; Payable awaits the result.

## The `TenantId` value object

`src/domain/value-objects/tenant-id.ts` is an immutable wrapper that rejects empty values:

```ts
static of(value: string): TenantId {
  const normalized = value.trim();
  if (normalized.length === 0) throw new TypeError('Tenant id cannot be empty');
  return new TenantId(normalized);
}
```

It exposes `toString()` and `equals()`. Tenant-scoped entities carry the raw `tenantId: string |
null` through the `TenantScoped` interface (`src/domain/entities/common.ts`).

## How tenant scoping flows

### Billable / customer operations

`Payable.customer(billable, providerName?, tenantId?)` resolves dependencies through
`Payable.dependencies` (`src/payable.ts`). When tenancy is enabled the tenant id is mandatory:

```ts
if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
  throw new PayableError('A tenant id is required when tenancy is enabled', {
    code: 'TENANT_REQUIRED',
  });
}
```

The resolved `tenantId` (or `null` when disabled) is placed on the dependencies and persisted with
every customer and payment. The isolation works as follows:

- Calling `payable.customer(billable)` with tenancy enabled and no tenant id throws `TENANT_REQUIRED`.
- `payable.customer(billable, undefined, 'tenant-a').charge(...)` and the same billable under
  `'tenant-b'` create **distinct** customer rows (`customerA.id !== customerB.id`), each tagged with
  its tenant.
- `storage.customers.findByBillable('User', '1', null)` returns `null` - the same billable under a
  `null` tenant does not collide with the tenant-scoped rows.
- Payments are likewise scoped: `tenant-a` sees its 1000-cent charge, `tenant-b` its 2000-cent
  charge.

### Webhooks

For webhooks the tenant is resolved per request in `ReceiveWebhookAction`
(`src/application/actions/webhooks/receive-webhook.action.ts`):

```ts
private async resolveTenant(input: ReceiveWebhookInput): Promise<string | null> {
  if (input.tenantId !== undefined) return input.tenantId;
  const resolver = this.deps.tenantResolver;
  if (!resolver) return null;
  return resolver.resolve({
    provider: this.deps.providerName,
    headers: input.headers ?? {},
    payload: input.payload,
  });
}
```

Precedence: an explicit `tenantId` on the input wins; otherwise the configured resolver runs;
otherwise the tenant is `null`.

The resolved tenant participates in deduplication. `StoreWebhookEventAction` looks up existing events
by `(provider, providerEventId, tenantId)`, so **the same provider event id is dedup-isolated across
tenants**: event `evt_1` received for `acme` and for `globex` both record as new
(`duplicate: false`), while a second `acme` delivery is a duplicate.

The audit log and outbox rows written by the processing pipeline also carry the resolved tenant id
(see [Webhooks](13-webhooks.md)).

### Cross-tenant replay

`ReplayWebhookAction` enforces tenant matching in addition to the replay policy. When a
`context.tenantId` is supplied it must equal the stored event's tenant
(`src/application/actions/webhooks/replay-webhook.action.ts`):

```ts
if (context.tenantId !== undefined && (event.tenantId ?? null) !== (context.tenantId ?? null)) {
  throw new PayableError('Webhook replay not permitted', { code: 'WEBHOOK_REPLAY_DENIED' });
}
```

So replaying an `acme` event with `tenantId: 'globex'` is denied, while `tenantId: 'acme'` succeeds.

## When tenancy is disabled (default)

With no `tenant` block, `tenantEnabled` is `false`:

- `payable.customer(billable)` does **not** require a tenant id; records persist with `tenantId:
  null`.
- Webhooks with no resolver default to a `null` tenant, and dedup operates on the `null` partition.
  The first delivery is new and the second is a duplicate, both with `tenantId: null`.

## Edge cases

| Scenario                                              | Outcome                                                  |
| ----------------------------------------------------- | -------------------------------------------------------- |
| Tenancy enabled, `customer()` called without tenant   | `TENANT_REQUIRED` thrown                                 |
| Same billable under two tenants                        | Distinct customer rows, each tenant-tagged               |
| Same billable under `null` tenant                      | Does not collide with tenant-scoped rows                 |
| Same provider event id across tenants                  | Treated as distinct events (dedup isolated)              |
| Webhook input carries explicit `tenantId`              | Overrides the resolver                                   |
| No resolver and no explicit tenant                     | Tenant resolves to `null`                                |
| Resolver returns `null`                                | Event is stored under the `null` tenant                  |
| `TenantId.of('')` / whitespace-only                    | Throws `TypeError`                                       |
| Replay with mismatched `context.tenantId`              | `WEBHOOK_REPLAY_DENIED`                                  |

---

[Previous: Reliability](15-reliability.md) · [Index](../00-index.md) · [Next: Providers](../integrations/17-providers.md)
