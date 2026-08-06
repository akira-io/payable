import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import {
  NO_SUBSCRIPTION_OPERATIONS,
  type SubscriptionOperationCapabilities,
} from '../src/domain/dtos/subscription-operation-capabilities.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('subscription operation guards', () => {
  it('rejects direct creation before syncing a customer or calling the provider', async () => {
    class CheckoutOnlyProvider extends FakeProvider {
      override subscriptionOperationCapabilities() {
        return {
          ...NO_SUBSCRIPTION_OPERATIONS,
          create: { checkout: true, direct: false },
        };
      }
    }
    const database = createTestDb();
    await migrate(database);
    const provider = new CheckoutOnlyProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });

    await expect(
      payable.customer(billable).newSubscription('default').price('price_pro').create(),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.create.direct' },
    });
    expect(provider.createCustomerCalls).toBe(0);
    expect(provider.createdSubscriptions).toBe(0);
    await database.destroy();
  });

  it('rejects subscription checkout before syncing a customer or creating a session', async () => {
    class DirectOnlyProvider extends FakeProvider {
      override subscriptionOperationCapabilities() {
        return {
          ...NO_SUBSCRIPTION_OPERATIONS,
          create: { checkout: false, direct: true },
        };
      }
    }
    const database = createTestDb();
    await migrate(database);
    const provider = new DirectOnlyProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });

    await expect(
      payable
        .customer(billable)
        .newSubscription('default')
        .price('price_pro')
        .checkout({ successUrl: 'https://success.test', cancelUrl: 'https://cancel.test' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.create.checkout' },
    });
    expect(provider.createCustomerCalls).toBe(0);
    expect(provider.lastCheckout).toBeUndefined();
    await database.destroy();
  });

  it('rejects an unsupported mutation before calling the provider', async () => {
    class ToggleProvider extends FakeProvider {
      operationsEnabled = true;

      override subscriptionOperationCapabilities(): SubscriptionOperationCapabilities {
        return this.operationsEnabled
          ? super.subscriptionOperationCapabilities()
          : NO_SUBSCRIPTION_OPERATIONS;
      }
    }
    const database = createTestDb();
    await migrate(database);
    const provider = new ToggleProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage: new KnexStorageDriver(database, new FakeClock()),
    });
    await payable.customer(billable).newSubscription('default').price('price_pro').create();
    provider.lastSubscriptionUpdate = undefined;
    provider.operationsEnabled = false;

    await expect(
      payable.customer(billable).subscription('default').swap('price_business'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_CAPABILITY_NOT_SUPPORTED',
      context: { capability: 'subscriptions.change-price' },
    });
    expect(provider.lastSubscriptionUpdate).toBeUndefined();
    await database.destroy();
  });
});
