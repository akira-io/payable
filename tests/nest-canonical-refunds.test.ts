import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { PayableCanonicalReadController } from '../src/presentation/nest/payable-canonical-read.controller';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('nest canonical refund adapter', () => {
  it('reads tenant-scoped canonical refunds and requires a local mutation key', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({ storage: new KnexStorageDriver(db, new FakeClock()) });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'nest-canonical-refunds',
      email: 'nest-canonical-refunds@example.com',
    });
    const payment = await payable.storedPayments().record({
      customerId: customer.id,
      amount: Money.of(900, 'EUR'),
      status: 'succeeded',
      collectionMethod: 'cash',
    });
    const refund = await payable.storedPayments().refundLocal(payment.id, {
      amount: Money.of(200, 'EUR'),
      collectionMethod: 'cash',
    });
    const controller = new PayableCanonicalReadController(payable, {});

    await expect(controller.getRefund({ headers: {} }, refund.id)).resolves.toMatchObject({
      id: refund.id,
    });
    await expect(
      controller.listRefunds({ headers: {} }, { paymentId: payment.id }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ id: refund.id })] });
    expect(() =>
      controller.recordPayment(
        { headers: {} },
        {
          customerId: customer.id,
          amount: 100,
          currency: 'EUR',
          status: 'pending',
          collectionMethod: 'cash',
        },
      ),
    ).toThrowError(PayableError);
    expect(() =>
      controller.recordPayment(
        {
          headers: { 'idempotency-key': 'repeated-key-a, repeated-key-b' },
          raw: {
            rawHeaders: ['Idempotency-Key', 'repeated-key-a', 'Idempotency-Key', 'repeated-key-b'],
          },
        },
        {
          customerId: customer.id,
          amount: 100,
          currency: 'EUR',
          status: 'pending',
          collectionMethod: 'cash',
        },
      ),
    ).toThrowError(PayableError);
    await db.destroy();
  });
});
