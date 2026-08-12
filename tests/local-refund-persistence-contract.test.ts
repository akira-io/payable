import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('confirmed local refund persistence', () => {
  it('rolls payment, refund, audit, and outbox writes back when outbox persistence fails', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(database, clock);
    const failingStorage = Object.create(storage) as KnexStorageDriver;
    failingStorage.transaction = (work) =>
      storage.transaction((repositories) =>
        work({
          ...repositories,
          outboxEvents: failingOutbox(repositories),
        }),
      );
    const payment = await storage.payments.create({
      tenantId: null,
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_rollback_contract',
      status: 'succeeded',
      currency: 'EUR',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: failingStorage,
      clock,
    });

    await expect(
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(400, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-rollback',
        confirmedExternally: true,
      }),
    ).rejects.toThrow('outbox unavailable');
    await expect(storage.payments.findById(payment.id)).resolves.toMatchObject({
      refundedAmount: 0,
      status: 'succeeded',
    });
    expect(await storage.refunds.listByPayment(payment.id)).toEqual([]);
    expect(await storage.auditLogs.list({ resourceId: payment.id })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });
});

function failingOutbox(repositories: Repositories) {
  return {
    ...repositories.outboxEvents,
    create: async () => {
      throw new Error('outbox unavailable');
    },
  };
}
