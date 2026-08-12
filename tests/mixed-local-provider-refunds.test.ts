import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const databases: ReturnType<typeof createTestDb>[] = [];
const authorization = { allowed: true, actorType: 'service' as const, actorId: 'cashier-1' };

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('confirmed local refunds for provider-backed payments', () => {
  it('records a confirmed external refund without invoking the payment provider', async () => {
    const { payable, payment, provider } = await harness({ authorization: true });

    const refund = await payable.storedPayments().refundLocal(payment.id, {
      amount: Money.of(400, 'EUR'),
      collectionMethod: 'bank_transfer',
      externalReference: 'bank-return-400',
      confirmedExternally: true,
      authorization,
    });

    expect(refund).toMatchObject({
      paymentId: payment.id,
      provider: null,
      providerRefundId: null,
      amount: 400,
      recordedBy: 'cashier-1',
    });
    expect(provider.refundCalls).toBe(0);
  });

  it.each([
    undefined,
    '   ',
  ])('requires a non-blank external reference before recording a confirmed provider-backed refund', async (externalReference) => {
    const { payable, payment } = await harness();

    await expect(
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(400, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference,
        confirmedExternally: true,
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_REFUND_EXTERNAL_REFERENCE_REQUIRED' });
  });

  it('requires explicit external confirmation for a provider-backed local refund', async () => {
    const { payable, payment, provider } = await harness();

    await expect(
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(400, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-400',
      }),
    ).rejects.toMatchObject({ code: 'LOCAL_REFUND_EXTERNAL_CONFIRMATION_REQUIRED' });
    expect(provider.refundCalls).toBe(0);
  });

  it('shares CAS reservation with a concurrent provider refund when both amounts fit', async () => {
    const { payable, payment, provider } = await harness();
    const localRefund = payable.storedPayments().refundLocal(payment.id, {
      amount: Money.of(600, 'EUR'),
      collectionMethod: 'bank_transfer',
      externalReference: 'bank-return-600',
      confirmedExternally: true,
    });
    const providerRefund = payable.refund({ paymentId: payment.id, amount: Money.of(400, 'EUR') });

    const results = await Promise.allSettled([localRefund, providerRefund]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(2);
    await expect(payable.storedPayments().retrieve(payment.id)).resolves.toMatchObject({
      refundedAmount: 1000,
      status: 'refunded',
    });
    expect(provider.refundCalls).toBe(1);
  });

  it('does not over-refund when concurrent local and provider refunds exceed the remaining amount', async () => {
    const { payable, payment, provider, storage } = await harness();
    const results = await Promise.allSettled([
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(700, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-700',
        confirmedExternally: true,
      }),
      payable.refund({ paymentId: payment.id, amount: Money.of(600, 'EUR') }),
    ]);

    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    await expect(payable.storedPayments().retrieve(payment.id)).resolves.toMatchObject({
      refundedAmount: expect.any(Number),
    });
    const paymentAfter = await payable.storedPayments().retrieve(payment.id);
    expect(paymentAfter.refundedAmount).toBeLessThanOrEqual(paymentAfter.amount);
    const refunds = await storage.refunds.listByPayment(payment.id);
    expect(
      refunds
        .filter(({ status }) => status !== 'failed')
        .reduce((total, refund) => total + refund.amount, 0),
    ).toBe(paymentAfter.refundedAmount);
    expect(provider.refundCalls).toBeLessThanOrEqual(1);
  });

  it('releases only the failed provider reservation when a local refund settles concurrently', async () => {
    const { payable, payment, provider } = await harness();
    let rejectProvider: ((error: Error) => void) | undefined;
    let providerEntered: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => {
      providerEntered = resolve;
    });
    const providerRefund = vi.spyOn(provider, 'refund').mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectProvider = reject;
          providerEntered?.();
        }),
    );

    const pendingProviderRefund = payable.refund({
      paymentId: payment.id,
      amount: Money.of(600, 'EUR'),
    });
    await entered;

    await expect(
      payable.storedPayments().refundLocal(payment.id, {
        amount: Money.of(400, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-during-provider-failure',
        confirmedExternally: true,
      }),
    ).resolves.toMatchObject({ amount: 400, provider: null });
    rejectProvider?.(new Error('provider unavailable'));
    await expect(pendingProviderRefund).rejects.toThrow('provider unavailable');
    await expect(payable.storedPayments().retrieve(payment.id)).resolves.toMatchObject({
      refundedAmount: 400,
      status: 'partially_refunded',
    });
    expect(providerRefund).toHaveBeenCalledTimes(1);
  });

  it('does not disclose a provider-backed payment across tenants', async () => {
    const { payable, payment } = await harness({ tenantId: 'tenant-a' });

    await expect(
      payable.storedPayments('tenant-b').refundLocal(payment.id, {
        amount: Money.of(400, 'EUR'),
        collectionMethod: 'bank_transfer',
        externalReference: 'bank-return-400',
        confirmedExternally: true,
      }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });

  it('replays a confirmed provider-backed refund by tenant-scoped idempotency key', async () => {
    const { payable, payment } = await harness({ idempotency: true, tenantId: 'tenant-a' });
    const input = {
      amount: Money.of(400, 'EUR'),
      collectionMethod: 'bank_transfer' as const,
      externalReference: 'bank-return-400',
      confirmedExternally: true,
      idempotencyKey: 'confirmed-provider-refund-400',
    };

    const first = await payable.storedPayments('tenant-a').refundLocal(payment.id, input);
    await expect(
      payable.storedPayments('tenant-a').refundLocal(payment.id, input),
    ).resolves.toEqual(first);
  });
});

async function harness(
  options: { authorization?: boolean; idempotency?: boolean; tenantId?: string } = {},
) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(database, clock);
  const provider = new FakeProvider();
  const payable = createPayable({
    providers: { stripe: provider },
    storage,
    clock,
    authorization: { enabled: options.authorization ?? false },
    idempotency: options.idempotency
      ? { store: new KnexIdempotencyRepository(database, clock) }
      : undefined,
    tenant: { enabled: options.tenantId !== undefined },
  });
  const payment = await storage.payments.create({
    tenantId: options.tenantId ?? null,
    customerId: null,
    provider: 'stripe',
    providerPaymentId: 'pi_provider-backed',
    status: 'succeeded',
    currency: 'EUR',
    amount: 1000,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
  return { payable, payment, provider, storage };
}
