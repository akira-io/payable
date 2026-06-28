# Getting Started

## Requirements

- **Node.js >= 20.** The package targets `node20`.
- The core has two runtime dependencies only: `dinero.js` and `zod`. Everything else is an optional
  peer.

## Install

```sh
npm install @akira-io/payable   # or: pnpm add / bun add
```

## Optional peers

Install only the peers for the features you use:

| Feature | Install | Peer range |
| --- | --- | --- |
| Stripe provider | `npm i stripe` | `>=15` |
| Paddle provider | `npm i @paddle/paddle-node-sdk` | `>=2` |
| SISP provider | `npm i @akira-io/sisp` | `>=1.0.0-beta.1` |
| Knex storage | `npm i knex` + a driver (`pg`, `better-sqlite3`, …) | `>=3` |
| Prisma storage | `npm i @prisma/client` | `>=5` |
| BullMQ queue | `npm i bullmq` | `>=5` |
| Express adapter | `npm i express` | `>=4.18` |
| Fastify adapter | `npm i fastify` | `>=4` |
| NestJS adapter | `npm i @nestjs/common reflect-metadata` | `@nestjs/common >=10`, `reflect-metadata >=0.2` |
| MCP adapter | `npm i @modelcontextprotocol/sdk` | `>=1.18` |

All optional peers are marked optional, so package managers do not require them at install time.

## Minimal example

`createPayable` requires at least one payment provider; `resolveConfig` throws
`TypeError('Payable requires at least one payment provider')` if `providers` is empty.

```ts
import { createPayable, Money, StripeProvider } from '@akira-io/payable';

const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
  },
});

Money.of(9900, 'USD').format(); // "$99.00"
```

With only providers supplied, the resolved defaults are: `SyncQueueDriver` for the queue,
`SystemClock` for the clock, `NullLogger` for the logger, `InMemoryEventBus` for events, and
idempotency `enabled: true` with strategy `auto`. Storage, cache, locks, and encryption stay
undefined, which disables features that require them (see [04-configuration.md](04-configuration.md)).

## Full example with storage, queue, and events

Storage is required for webhooks, idempotency, the audit log, the outbox, charges, refunds, and
subscription management. The Knex driver provisions its schema with `migrate(db)`.

```ts
import knex from 'knex';
import {
  createPayable,
  KnexStorageDriver,
  migrate,
  BullMQQueueDriver,
  InMemoryEventBus,
  StripeProvider,
} from '@akira-io/payable';

const db = knex({ client: 'pg', connection: process.env.DATABASE_URL });
await migrate(db); // creates tables and applies additive column migrations; safe to run repeatedly

const events = new InMemoryEventBus();
events.listen('subscription.created', async (event) => {
  // react to the domain event
});

const payable = createPayable({
  providers: {
    stripe: new StripeProvider({
      secretKey: process.env.STRIPE_SECRET_KEY ?? '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    }),
  },
  storage: new KnexStorageDriver(db),
  queue: new BullMQQueueDriver(/* … */),
  events,
});
```

## First subscription checkout

The fluent entry point is `payable.customer(billable)`, which returns a `CustomerContext`. From
there, `newSubscription(name)` returns a `SubscriptionBuilder`. A price is required before
`checkout()`; otherwise the builder throws `PayableError` with code `CHECKOUT_PRICE_REQUIRED`.

```ts
const billable = { billableType: 'User', billableId: user.id, email: user.email };

const session = await payable
  .customer(billable)
  .newSubscription('default')
  .price('price_pro_monthly')
  .trialDays(14)
  .checkout({
    successUrl: 'https://app.com/success',
    cancelUrl: 'https://app.com/cancel',
  });

// session is a CheckoutSessionDTO; redirect the user to its provider checkout URL.
```

A `Billable` is `{ billableType: string; billableId: string; email?: string; name?: string }`.
`CustomerContext` also exposes `checkout()` (payment
mode), `charge(...)`, `billingPortal(returnUrl)`, and `subscription(name)` for
`swap`/`cancel`/`cancelNow`/`resume`/`updateQuantity`.

## Nothing is read from the environment

The library never reads `process.env` itself. The application reads its own secrets and passes them
into the provider constructor and `createPayable`. Configuration is fully explicit and injected.

---

[Previous: Architecture](02-architecture.md) · [Index](00-index.md) · [Next: Configuration](04-configuration.md)
