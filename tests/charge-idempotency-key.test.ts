import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const clock = new FakeClock();
  const provider = new FakeProvider();
  const payable = createPayable({
    providers: { stripe: provider },
    storage: new KnexStorageDriver(db, clock),
    idempotency: { store: new KnexIdempotencyRepository(db, clock) },
  });
  return { db, provider, payable };
}

describe('charge idempotency key (#468)', () => {
  it('treats two reference-less charges of the same amount as independent', async () => {
    const { db, provider, payable } = await setup();

    const first = await payable.customer(billable).charge({ amount: Money.of(1000, 'USD') });
    const second = await payable.customer(billable).charge({ amount: Money.of(1000, 'USD') });

    expect(second.id).not.toBe(first.id);
    expect(provider.chargeCalls).toBe(2);
    await db.destroy();
  });

  it('still deduplicates charges that share an explicit reference', async () => {
    const { db, provider, payable } = await setup();

    const first = await payable
      .customer(billable)
      .charge({ amount: Money.of(1000, 'USD'), reference: 'order-1' });
    const second = await payable
      .customer(billable)
      .charge({ amount: Money.of(1000, 'USD'), reference: 'order-1' });

    expect(second.id).toBe(first.id);
    expect(provider.chargeCalls).toBe(1);
    await db.destroy();
  });

  it('warns when idempotency is configured but a charge has no reference', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const warnings: string[] = [];
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(db, clock),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
      logger: {
        debug() {},
        info() {},
        warn: (message) => warnings.push(message),
        error() {},
      },
    });

    await payable.customer(billable).charge({ amount: Money.of(1000, 'USD') });
    expect(warnings.some((message) => message.includes('no reference'))).toBe(true);

    warnings.length = 0;
    await payable
      .customer(billable)
      .charge({ amount: Money.of(1000, 'USD'), reference: 'order-9' });
    expect(warnings).toHaveLength(0);
    await db.destroy();
  });
});
