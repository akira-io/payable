import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';

let prisma: PrismaClientLike;
let storage: PrismaStorageDriver;

beforeAll(async () => {
  prisma = await createPrismaTestClient();
  storage = new PrismaStorageDriver(prisma, new FakeClock());
}, 120_000);

afterAll(async () => {
  await disconnectPrisma(prisma);
});

describe('Prisma provider-neutral collection pages', () => {
  it('matches filters and keyset ordering across local resources', async () => {
    const tenantId = 'prisma-provider-neutral-pages';
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'User',
      billableId: 'prisma-pages-user',
      email: 'pages@example.com',
    });
    const starter = await payable.products(tenantId).create({ name: 'Starter' });
    const growth = await payable.products(tenantId).create({ name: 'Growth plan' });
    const price = await payable.prices(tenantId).create({
      productId: growth.id,
      unitAmount: Money.of(4900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      lookupKey: 'growth_monthly',
    });
    const subscription = await payable.canonicalSubscriptions(tenantId).create({
      customerId: customer.id,
      name: 'growth',
      priceId: price.id,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'test',
    });
    const payment = await storage.payments.create({
      tenantId,
      customerId: customer.id,
      provider: 'manual',
      providerPaymentId: null,
      status: 'pending',
      currency: 'EUR',
      amount: 4900,
      refundedAmount: 0,
      reference: 'BANK-PRISMA-100',
      description: 'Manual transfer',
    });

    await expect(payable.products(tenantId).list({ name: 'GROWTH' })).resolves.toMatchObject({
      items: [growth],
      hasMore: false,
    });
    await expect(
      payable.prices(tenantId).list({ lookupKey: 'growth_monthly' }),
    ).resolves.toMatchObject({ items: [price], hasMore: false });
    await expect(
      payable.canonicalSubscriptions(tenantId).list({ customerId: customer.id }),
    ).resolves.toMatchObject({ items: [subscription], hasMore: false });
    await expect(
      payable.storedPayments(tenantId).list({ reference: 'prisma' }),
    ).resolves.toMatchObject({ items: [payment], hasMore: false });

    const first = await payable.products(tenantId).list({ limit: 1 });
    const second = await payable.products(tenantId).list({
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual(
      [starter.id, growth.id].sort(),
    );
  });
});
