# NestJS with Prisma

Register Payable as a NestJS module and use Prisma for the billing ledger.

## Prerequisites

- `@akira-io/payable`, `@nestjs/common`, `@nestjs/core`, `reflect-metadata`, and `@prisma/client`
- Payable's Prisma models synchronized into the application schema
- A generated Prisma Client and an applied database migration

## Configuration

Synchronize the maintained models, generate the client, and deploy the migration through the
application's normal Prisma workflow.

```sh
bunx payable-prisma sync
bunx prisma generate
bunx prisma migrate deploy
```

```ts
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPayable, StripeProvider } from '@akira-io/payable';
import { PayableModule } from '@akira-io/payable/nest';
import { PrismaStorageDriver } from '@akira-io/payable/prisma';

const prisma = new PrismaClient();
const stripe = new StripeProvider({
  secretKey: process.env.STRIPE_SECRET_KEY ?? '',
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
});
const payable = createPayable({
  providers: { stripe },
  storage: new PrismaStorageDriver(prisma),
});

@Module({ imports: [PayableModule.forRoot(payable)] })
export class AppModule {}
```

## Run the example

```ts
import { NestFactory } from '@nestjs/core';

const app = await NestFactory.create(AppModule, { rawBody: true });
await app.listen(3000);
```

Pass an authentication guard with `PayableModule.forRoot(payable, { authenticate: ApiKeyGuard })`
when the built-in routes should share one NestJS guard.

## Expected result

NestJS resolves Payable's controller and services, while Prisma reads and writes the same physical
`payable_*` tables used by the Knex adapter. `rawBody: true` preserves signed webhook payloads.

## Failure behavior

The Prisma adapter does not run migrations. An outdated synchronized model file can fail at runtime
when the package expects a newer column. Omitting `rawBody: true` causes signed webhook verification
to fail. See [NestJS Adapter](../adapters/25-nestjs.md) and
[Prisma Storage](../persistence/21b-storage-prisma.md).

---

[Previous: Fastify and Knex](40-fastify-knex.md) | [Index](../00-index.md) | [Next: SISP](42-sisp-redirect-checkout.md)
