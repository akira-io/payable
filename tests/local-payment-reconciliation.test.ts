import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('local payment idempotency reconciliation', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('requires reconciliation instead of duplicating a refund after result persistence fails', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-12T10:00:00.000Z'));
    const idempotency = new KnexIdempotencyRepository(database, clock);
    idempotency.markCompleted = async () => {
      throw new Error('idempotency result storage unavailable');
    };
    const payable = createPayable({
      storage: new KnexStorageDriver(database, clock),
      clock,
      idempotency: { store: idempotency },
    });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'customer-refund-reconciliation',
      email: 'refund-reconciliation@example.com',
    });
    const payment = await payable.storedPayments().record({
      customerId: customer.id,
      amount: Money.of(1000, 'EUR'),
      status: 'succeeded',
      collectionMethod: 'cash',
    });
    const refund = {
      amount: Money.of(500, 'EUR'),
      collectionMethod: 'cash' as const,
      idempotencyKey: 'refund-reconciliation-1',
    };

    await expect(payable.storedPayments().refundLocal(payment.id, refund)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
    });
    await expect(payable.storedPayments().refundLocal(payment.id, refund)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    await expect(payable.storedPayments().retrieve(payment.id)).resolves.toMatchObject({
      refundedAmount: 500,
      status: 'partially_refunded',
    });
    await expect(
      payable.storedPayments().listRefunds({ paymentId: payment.id }),
    ).resolves.toMatchObject({
      items: [expect.objectContaining({ amount: 500 })],
    });
  });
});
