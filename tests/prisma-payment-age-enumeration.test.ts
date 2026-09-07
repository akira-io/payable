import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createPrismaTestClient, disconnectPrisma } from './support/prisma';

const OLD = new Date('2026-01-01T00:00:00.000Z');
const RECENT = new Date('2026-01-09T00:00:00.000Z');
const CUTOFF = new Date('2026-01-05T00:00:00.000Z');

let prisma: PrismaClientLike;
let clock: FakeClock;
let storage: PrismaStorageDriver;

beforeAll(async () => {
  prisma = await createPrismaTestClient();
  clock = new FakeClock(OLD);
  storage = new PrismaStorageDriver(prisma, clock);
}, 120_000);

afterAll(async () => {
  await disconnectPrisma(prisma);
});

describe('Prisma payment enumeration by age', () => {
  it('applies the cutoff exclusively, like the knex adapter', async () => {
    const tenantId = 'prisma-payment-age';
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'User',
      billableId: 'prisma-payment-age-user',
      email: 'age@example.com',
    });
    const payments = payable.storedPayments(tenantId);

    clock.set(OLD);
    const stuck = await payments.record({
      customerId: customer.id,
      amount: Money.of(9999, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'PRISMA-AGE-OLD',
    });
    clock.set(CUTOFF);
    const boundary = await payments.record({
      customerId: customer.id,
      amount: Money.of(9999, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'PRISMA-AGE-BOUNDARY',
    });
    clock.set(RECENT);
    const fresh = await payments.record({
      customerId: customer.id,
      amount: Money.of(9999, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'PRISMA-AGE-RECENT',
    });

    const swept = await payments.list({ limit: 10, status: 'pending', createdBefore: CUTOFF });

    const ids = swept.items.map((payment) => payment.id);
    expect(ids).toEqual([stuck.id]);
    expect(ids).not.toContain(boundary.id);
    expect(ids).not.toContain(fresh.id);
  });

  it('pages through one cutoff without losing or repeating a payment', async () => {
    const tenantId = 'prisma-payment-age-cursor';
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'User',
      billableId: 'prisma-payment-age-cursor-user',
      email: 'age-cursor@example.com',
    });
    const payments = payable.storedPayments(tenantId);

    clock.set(OLD);
    const first = await payments.record({
      customerId: customer.id,
      amount: Money.of(9999, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'PRISMA-CURSOR-1',
    });
    clock.set(new Date('2026-01-02T00:00:00.000Z'));
    const second = await payments.record({
      customerId: customer.id,
      amount: Money.of(9999, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'PRISMA-CURSOR-2',
    });

    const pageOne = await payments.list({ limit: 1, status: 'pending', createdBefore: CUTOFF });
    expect(pageOne.nextCursor).not.toBeNull();
    const pageTwo = await payments.list({
      limit: 1,
      status: 'pending',
      createdBefore: CUTOFF,
      cursor: pageOne.nextCursor ?? '',
    });

    expect([...pageOne.items, ...pageTwo.items].map((payment) => payment.id)).toEqual([
      second.id,
      first.id,
    ]);
  });
});
