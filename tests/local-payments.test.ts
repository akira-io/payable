import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

describe('canonical local payments', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('records providerless collection evidence without a payment provider', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-12T10:00:00.000Z'));
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, 'tenant-local').create({
      billableType: 'User',
      billableId: 'customer-1',
      email: 'customer@example.com',
    });

    const payment = await payable.storedPayments('tenant-local').record({
      customerId: customer.id,
      amount: Money.of(2500, 'EUR'),
      status: 'succeeded',
      collectionMethod: 'cash',
      occurredAt: new Date('2026-08-12T09:30:00.000Z'),
      externalReference: 'receipt-42',
      description: 'Counter sale',
    });

    expect(payment).toMatchObject({
      tenantId: 'tenant-local',
      customerId: customer.id,
      provider: null,
      providerPaymentId: null,
      status: 'succeeded',
      amount: 2500,
      currency: 'EUR',
      collectionMethod: 'cash',
      occurredAt: new Date('2026-08-12T09:30:00.000Z'),
      externalReference: 'receipt-42',
    });
    await expect(payable.storedPayments('tenant-local').retrieve(payment.id)).resolves.toEqual(
      payment,
    );
  });

  it('succeeds, voids, and refunds local payments by canonical identity', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-12T10:00:00.000Z'));
    const storage = new KnexStorageDriver(database, clock);
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, 'tenant-local').create({
      billableType: 'User',
      billableId: 'customer-2',
      email: 'two@example.com',
    });
    const pending = await payable.storedPayments('tenant-local').record({
      customerId: customer.id,
      amount: Money.of(3000, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
      externalReference: 'transfer-1',
    });
    const succeeded = await payable.storedPayments('tenant-local').succeed(pending.id);
    const partial = await payable.storedPayments('tenant-local').refundLocal(succeeded.id, {
      amount: Money.of(700, 'EUR'),
      collectionMethod: 'bank_transfer',
      externalReference: 'return-1',
      reason: 'partial return',
    });
    expect(partial).toMatchObject({
      paymentId: pending.id,
      provider: null,
      providerRefundId: null,
      status: 'succeeded',
      amount: 700,
      collectionMethod: 'bank_transfer',
    });
    await expect(
      payable.storedPayments('tenant-local').retrieveRefund(partial.id),
    ).resolves.toEqual(partial);
    await expect(
      payable.storedPayments('tenant-local').listRefunds({ paymentId: pending.id }),
    ).resolves.toMatchObject({ items: [partial], hasMore: false, nextCursor: null });
    await expect(
      payable.storedPayments('tenant-local').retrieve(pending.id),
    ).resolves.toMatchObject({
      status: 'partially_refunded',
      refundedAmount: 700,
    });
    const finalRefund = await payable.storedPayments('tenant-local').refundLocal(pending.id, {
      amount: Money.of(2300, 'EUR'),
      collectionMethod: 'bank_transfer',
      externalReference: 'return-2',
    });
    const firstRefundPage = await payable
      .storedPayments('tenant-local')
      .listRefunds({ paymentId: pending.id, limit: 1 });
    const secondRefundPage = await payable.storedPayments('tenant-local').listRefunds({
      paymentId: pending.id,
      limit: 1,
      cursor: firstRefundPage.nextCursor ?? undefined,
    });
    expect(firstRefundPage).toMatchObject({ hasMore: true, nextCursor: expect.any(String) });
    expect(
      [...firstRefundPage.items, ...secondRefundPage.items].map(({ id }) => id).sort(),
    ).toEqual([partial.id, finalRefund.id].sort());
    await expect(
      payable.storedPayments('tenant-other').retrieveRefund(partial.id),
    ).rejects.toMatchObject({ code: 'REFUND_NOT_FOUND' });

    const voidable = await payable.storedPayments('tenant-local').record({
      customerId: customer.id,
      amount: Money.of(500, 'EUR'),
      status: 'pending',
      collectionMethod: 'cheque',
    });
    await expect(payable.storedPayments('tenant-local').void(voidable.id)).resolves.toMatchObject({
      status: 'canceled',
    });
  });

  it('replays identical records and rejects reuse with different evidence', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-12T10:00:00.000Z'));
    const payable = createPayable({
      storage: new KnexStorageDriver(database, clock),
      clock,
      idempotency: { store: new KnexIdempotencyRepository(database, clock) },
    });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'customer-idempotent',
      email: 'idem@example.com',
    });
    const input = {
      customerId: customer.id,
      amount: Money.of(1200, 'EUR'),
      status: 'succeeded' as const,
      collectionMethod: 'cash' as const,
      externalReference: 'receipt-1200',
      idempotencyKey: 'counter-1200',
    };

    const first = await payable.storedPayments().record(input);
    await expect(payable.storedPayments().record(input)).resolves.toEqual(first);
    await expect(
      payable.storedPayments().record({ ...input, externalReference: 'receipt-different' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(payable.storedPayments().list()).resolves.toMatchObject({
      items: [expect.objectContaining({ id: first.id })],
    });
  });

  it('replays a local void transition with the same idempotency key', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-12T10:00:00.000Z'));
    const payable = createPayable({
      storage: new KnexStorageDriver(database, clock),
      clock,
      idempotency: { store: new KnexIdempotencyRepository(database, clock) },
    });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'customer-void',
      email: 'void@example.com',
    });
    const pending = await payable.storedPayments().record({
      customerId: customer.id,
      amount: Money.of(900, 'EUR'),
      status: 'pending',
      collectionMethod: 'cheque',
    });

    const first = await payable.storedPayments().void(pending.id, { idempotencyKey: 'void-900' });
    await expect(
      payable.storedPayments().void(pending.id, { idempotencyKey: 'void-900' }),
    ).resolves.toEqual(first);
  });

  it('serializes concurrent partial refunds without exceeding the payment amount', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const payable = createPayable({
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'customer-concurrent',
      email: 'race@example.com',
    });
    const payment = await payable.storedPayments().record({
      customerId: customer.id,
      amount: Money.of(1000, 'EUR'),
      status: 'succeeded',
      collectionMethod: 'cash',
    });
    const refund = (amount: number, reference: string) =>
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(amount, 'EUR'),
        collectionMethod: 'cash',
        externalReference: reference,
      });

    const results = await Promise.allSettled([refund(700, 'return-a'), refund(700, 'return-b')]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    await expect(payable.storedPayments().retrieve(payment.id)).resolves.toMatchObject({
      refundedAmount: 700,
      status: 'partially_refunded',
    });
  });

  it('enforces authorization before recording a local payment', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const payable = createPayable({
      storage: new KnexStorageDriver(database, new FakeClock()),
      authorization: { enabled: true },
    });
    const customer = await payable.customers().create({
      billableType: 'User',
      billableId: 'customer-auth',
      email: 'auth@example.com',
    });
    const input = {
      customerId: customer.id,
      amount: Money.of(1000, 'EUR'),
      status: 'succeeded' as const,
      collectionMethod: 'cash' as const,
    };

    await expect(payable.storedPayments().record(input)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    await expect(
      payable.storedPayments().record({
        ...input,
        authorization: { allowed: true, actorType: 'service', actorId: 'cashier-1' },
      }),
    ).resolves.toMatchObject({ recordedBy: 'cashier-1' });
  });
});
