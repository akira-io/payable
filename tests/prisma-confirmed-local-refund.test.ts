import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
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

describe('Prisma confirmed local refunds', () => {
  it('persists provider-backed confirmed refund evidence without calling the provider', async () => {
    const provider = new FakeProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage });
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_prisma_confirmed_local_refund',
      status: 'succeeded',
      currency: 'EUR',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    const refund = await payable.storedPayments().refundLocal(payment.id, {
      amount: Money.of(400, 'EUR'),
      collectionMethod: 'bank_transfer',
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      externalReference: 'bank-return-prisma-400',
      confirmedExternally: true,
      authorization: { allowed: true, actorType: 'service', actorId: 'cashier-prisma' },
    });

    expect(refund).toMatchObject({
      paymentId: payment.id,
      provider: null,
      providerRefundId: null,
      collectionMethod: 'bank_transfer',
      externalReference: 'bank-return-prisma-400',
      recordedBy: 'cashier-prisma',
    });
    await expect(storage.refunds.findById(refund.id)).resolves.toMatchObject({
      id: refund.id,
      provider: null,
      externalReference: 'bank-return-prisma-400',
    });
    await expect(storage.payments.findById(payment.id)).resolves.toMatchObject({
      refundedAmount: 400,
      status: 'partially_refunded',
    });
    expect(provider.refundCalls).toBe(0);
  });
});
