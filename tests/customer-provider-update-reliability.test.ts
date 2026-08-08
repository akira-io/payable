import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { UpdateCustomerInput } from '../src/domain/dtos/customer.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('customer provider update reliability', () => {
  const databases: ReturnType<typeof createTestDb>[] = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('derives bounded update keys from canonical content, not timestamp alone', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const provider = new RecordingCustomerProvider('cus_update_key');
    const customers = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    }).customers('stripe');
    const billable = {
      billableType: 'User',
      billableId: 'x'.repeat(430),
      email: 'customer@example.com',
      name: 'Customer',
    };
    await customers.create(billable);
    await customers.sync(billable);

    await customers.update(billable, { email: 'first@example.com' });
    await customers.sync(billable);
    const firstKey = provider.lastUpdateKey;
    await customers.update(billable, { name: 'Second payload in the same millisecond' });
    await customers.sync(billable);
    const secondKey = provider.lastUpdateKey;

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey?.length).toBeLessThanOrEqual(255);
    expect(secondKey?.length).toBeLessThanOrEqual(255);
  });

  it('preserves the last successful synchronization time after an update failure', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-08T10:00:00.000Z'));
    const provider = new FakeProvider('cus_preserve_sync');
    const customers = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, clock),
    }).customers('stripe');
    const billable = {
      billableType: 'User',
      billableId: 'preserve-sync',
      email: 'customer@example.com',
      name: 'Customer',
    };
    await customers.create(billable);
    await customers.sync(billable);
    const synchronizedAt = (await customers.syncState(billable))?.synchronizedAt;
    clock.advance(1_000);
    await customers.update(billable, { name: 'Updated' });
    provider.updateCustomer = async () => {
      throw Object.assign(new Error('provider unavailable'), { code: 'ETIMEDOUT' });
    };

    await expect(customers.sync(billable)).rejects.toThrow('provider unavailable');

    await expect(customers.syncState(billable)).resolves.toMatchObject({
      status: 'failed',
      synchronizedAt,
    });
  });
});

class RecordingCustomerProvider extends FakeProvider {
  lastUpdateKey?: string;

  override updateCustomer(input: UpdateCustomerInput, context?: OperationContext) {
    this.lastUpdateKey = context?.idempotencyKey;
    return super.updateCustomer(input);
  }
}
