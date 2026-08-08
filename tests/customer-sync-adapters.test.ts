import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createFastifyPayablePlugin } from '../src/presentation/fastify/create-fastify-payable-plugin';
import { PayableController } from '../src/presentation/nest/payable.controller';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: '1',
  email: 'user@example.com',
  name: 'User',
};

describe('customer sync adapters', () => {
  it('synchronizes a local customer through Fastify', async () => {
    const database = createTestDb();
    await migrate(database);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const app = Fastify();
    await app.register(createFastifyPayablePlugin(payable), { prefix: '/payable' });

    await app.inject({
      method: 'POST',
      url: '/payable/customers',
      payload: { billable },
    });
    const synchronized = await app.inject({
      method: 'POST',
      url: '/payable/customers/sync',
      payload: { provider: 'stripe', billable },
    });

    expect(synchronized.statusCode).toBe(200);
    expect(synchronized.json()).toEqual({ providerCustomerId: 'cus_fake' });
    await app.close();
    await database.destroy();
  });

  it('synchronizes a local customer through Nest', async () => {
    const database = createTestDb();
    await migrate(database);
    const payable = createPayable({
      providers: { stripe: new FakeProvider() },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    const controller = new PayableController(payable, {});

    await controller.createCustomer({ headers: {} }, { billable });
    await expect(
      controller.syncCustomer({ headers: {} }, { provider: 'stripe', billable }),
    ).resolves.toEqual({ providerCustomerId: 'cus_fake' });

    await database.destroy();
  });
});
