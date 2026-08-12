import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';
import { createTestDb } from './support/knex';

const databases: ReturnType<typeof createTestDb>[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
});

describe('confirmed local refund idempotency', () => {
  it('rejects a changed confirmed external refund request for the same key', async () => {
    const { payable, payment } = await harness();
    const input = {
      amount: Money.of(400, 'EUR'),
      collectionMethod: 'bank_transfer' as const,
      externalReference: 'bank-return-400',
      confirmedExternally: true,
      idempotencyKey: 'confirmed-refund-conflict',
    };

    await payable.storedPayments().refundLocal(payment.id, input);
    await expect(
      payable.storedPayments().refundLocal(payment.id, {
        ...input,
        externalReference: 'bank-return-changed',
      }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('rejects a concurrent confirmed refund while its idempotency key is processing', async () => {
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const releaseGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enteredOutbox = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const { payable, payment } = await harness({
      pauseOutbox: async () => {
        entered?.();
        await releaseGate;
      },
    });
    const input = {
      amount: Money.of(400, 'EUR'),
      collectionMethod: 'bank_transfer' as const,
      externalReference: 'bank-return-processing',
      confirmedExternally: true,
      idempotencyKey: 'confirmed-refund-processing',
    };

    const first = payable.storedPayments().refundLocal(payment.id, input);
    await enteredOutbox;
    const second = payable.storedPayments().refundLocal(payment.id, input);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('idempotency acquisition did not settle')), 250);
    });
    try {
      await expect(Promise.race([second, deadline])).rejects.toMatchObject({
        code: 'IDEMPOTENCY_IN_PROGRESS',
      });
    } finally {
      clearTimeout(timeout);
      release?.();
    }
    await expect(first).resolves.toMatchObject({ amount: 400 });
  });
});

async function harness(options: { pauseOutbox?: () => Promise<void> } = {}) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(database, clock);
  const transactionStorage = Object.create(storage) as KnexStorageDriver;
  if (options.pauseOutbox) {
    transactionStorage.transaction = (work) =>
      storage.transaction((repositories) =>
        work({
          ...repositories,
          outboxEvents: {
            ...repositories.outboxEvents,
            create: async (event) => {
              await options.pauseOutbox?.();
              return repositories.outboxEvents.create(event);
            },
          },
        }),
      );
  }
  const payable = createPayable({
    providers: { stripe: new FakeProvider() },
    storage: transactionStorage,
    clock,
    idempotency: { store: new InMemoryIdempotencyStore() },
  });
  const payment = await storage.payments.create({
    tenantId: null,
    customerId: null,
    provider: 'stripe',
    providerPaymentId: 'pi_idempotency_contract',
    status: 'succeeded',
    currency: 'EUR',
    amount: 1000,
    refundedAmount: 0,
    reference: null,
    description: null,
  });
  return { payable, payment };
}
