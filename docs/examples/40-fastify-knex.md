# Fastify with Knex

Mount Payable's Fastify routes and persist billing data through Knex.

## Prerequisites

- `@akira-io/payable`, `fastify`, `knex`, and a Knex database driver
- At least one configured payment provider
- A database account allowed to create and alter Payable tables during deployment

## Configuration

```ts
import Fastify from 'fastify';
import knex from 'knex';
import {
  createPayable,
  KnexStorageDriver,
  migrate,
  StripeProvider,
} from '@akira-io/payable';
import { createFastifyPayablePlugin } from '@akira-io/payable/fastify';

const db = knex({ client: 'pg', connection: process.env.DATABASE_URL });
await migrate(db);

const storage = new KnexStorageDriver(db);
const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
  },
  storage,
});
```

## Run the example

```ts
const app = Fastify();

await app.register(createFastifyPayablePlugin(payable), {
  prefix: '/billing',
});

await app.listen({ host: '127.0.0.1', port: 3000 });
```

Configure authentication around the mounted routes and point Stripe at
`POST /billing/webhooks/stripe`.

## Expected result

Fastify exposes Payable's checkout, subscription, refund, and webhook endpoints under `/billing`.
Knex stores customers, payments, subscriptions, refunds, webhook events, idempotency records, audit
entries, and outbox events in `payable_*` tables.

## Failure behavior

The adapter does not add authentication. A webhook with a parsed instead of raw payload fails
signature verification. Run `migrate(db)` during deployment before accepting billing traffic; missing
tables surface as database errors. See [Fastify Adapter](../adapters/24-fastify.md) and
[Knex Storage](../persistence/21-storage-knex.md).

---

[Previous: Webhooks](39-webhooks-reconciliation.md) | [Index](../00-index.md) | [Next: NestJS and Prisma](41-nestjs-prisma.md)
