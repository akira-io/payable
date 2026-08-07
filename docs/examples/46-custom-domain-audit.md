# Custom domain audit

Payable's audit log is not limited to billing events. A host application can append its own domain
events to the same immutable, tenant-scoped hash chain and read them through an opaque cursor. Payable
owns persistence, validation, pagination, and chain verification; the host owns authorization,
retention policy, and user-facing labels.

## Record an application event

Create a resource for one trusted tenant. The tenant is bound once and cannot be overridden by an
individual record or query.

```ts
const audit = payable.audit(tenantId);

await audit.record({
  action: 'catalogue.product.created',
  resourceType: 'product',
  resourceId: product.id,
  correlationId: requestId,
  actorType: 'user',
  actorId: userId,
  before: null,
  after: {
    id: product.id,
    name: product.name,
    active: product.active,
  },
  metadata: { source: 'dashboard' },
});
```

Action and resource names are application-owned strings, not a Payable enum. Prefer stable,
namespaced actions such as `catalogue.product.created`, `identity.member.invited`, or
`settings.provider.changed`.

`record()` atomically appends one audit entry. It cannot make an unrelated host mutation atomic by
itself. Use a transaction-scoped repository when the domain write and audit append must commit or
roll back together.

## Read pages and apply retention

The host supplies its effective retention cutoff. Payable does not know subscription plans or infer a
retention period.

```ts
const retentionCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

const page = await payable.audit(tenantId).list({
  actions: ['catalogue.product.created', 'catalogue.product.updated'],
  resourceTypes: ['product', 'price'],
  resourceIds: [product.id, ...productPriceIds],
  createdAfter: retentionCutoff,
  limit: 50,
});

if (page.nextCursor) {
  const nextPage = await payable.audit(tenantId).list({
    resourceIds: [product.id, ...productPriceIds],
    createdAfter: retentionCutoff,
    limit: 50,
    cursor: page.nextCursor,
  });
  console.log(nextPage.data);
}
```

The cursor is opaque and follows the tenant's immutable chain sequence in descending order. Do not
decode it or construct one in application code.

Use `await payable.audit(tenantId).verify()` to verify the tenant's complete hash chain. The legacy
`payable.auditLogs(tenantId).run(query)` reader remains supported for array-based queries, but new
paginated integrations should use `audit().list()`.

## Compose with a Knex transaction

Construct the exported adapter repository over the host transaction:

```ts
import {
  AuditResource,
  KnexAuditLogRepository,
  SystemClock,
} from '@akira-io/payable';

await knex.transaction(async (transaction) => {
  const [product] = await transaction('products').insert(input).returning('*');
  const repository = new KnexAuditLogRepository(
    transaction,
    new SystemClock(),
    process.env.PAYABLE_AUDIT_KEY,
  );

  await new AuditResource(repository, tenantId).record({
    action: 'catalogue.product.created',
    resourceType: 'product',
    resourceId: product.id,
    correlationId: requestId,
    actorType: 'user',
    actorId: userId,
    after: product,
  });
});
```

## Compose with a Prisma transaction

The Prisma repository is exported from the Prisma adapter entry point:

```ts
import { AuditResource, SystemClock } from '@akira-io/payable';
import { PrismaAuditLogRepository } from '@akira-io/payable/prisma';

await prisma.$transaction(async (transaction) => {
  const product = await transaction.product.create({ data: input });
  const repository = new PrismaAuditLogRepository(
    transaction,
    new SystemClock(),
    process.env.PAYABLE_AUDIT_KEY,
  );

  await new AuditResource(repository, tenantId).record({
    action: 'catalogue.product.created',
    resourceType: 'product',
    resourceId: product.id,
    correlationId: requestId,
    actorType: 'user',
    actorId: userId,
    after: product,
  });
});
```

Use the same audit key and clock configuration as the main storage driver. A failure anywhere in the
host transaction rolls back both the domain mutation and the audit entry.

## Security boundary

This is a library API. Payable does not register a generic audit-write route or MCP tool. Authenticate
and authorize the host operation before invoking `record()`.

Do not record secrets, provider credentials, payment instrument data, or unrestricted request bodies.
Store only the minimal before/after state and metadata needed to explain the domain transition.

---

[Previous: Catalog Lifecycle](45-catalog-lifecycle.md) | [Index](../00-index.md) | [Next: Advanced Subscription Operations](47-subscription-operations.md)
