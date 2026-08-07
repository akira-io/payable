import { afterEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import {
  RevolutProvider,
  type RevolutProviderOptions,
} from '../src/infrastructure/providers/revolut/revolut-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const billable = {
  billableType: 'User',
  billableId: 'revolut-change-user',
  email: 'revolut@example.com',
};

function revolutFetch(onScheduledChange: () => void): NonNullable<RevolutProviderOptions['fetch']> {
  return async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/customers') {
      return jsonResponse(
        {
          id: 'customer_revolut',
          email: billable.email,
          full_name: null,
          created_at: '2026-08-07T10:00:00Z',
          updated_at: '2026-08-07T10:00:00Z',
          payment_methods: [],
        },
        201,
      );
    }
    if (path === '/api/subscriptions' && init?.method === 'POST') {
      return jsonResponse(revolutSubscription('price_old'), 201);
    }
    if (path.endsWith('/change-plan')) {
      onScheduledChange();
      return new Response(null, { status: 204 });
    }
    return jsonResponse(revolutSubscription('price_old'));
  };
}

function revolutSubscription(priceId: string) {
  return {
    id: 'subscription_revolut',
    state: 'active',
    customer_id: 'customer_revolut',
    plan_id: 'plan_revolut',
    plan_variation_id: priceId,
    payment_method_type: 'automatic',
    created_at: '2026-08-07T10:00:00Z',
    updated_at: '2026-08-07T10:00:00Z',
    current_cycle_id: 'cycle_revolut',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Revolut scheduled subscription changes', () => {
  const databases: Array<ReturnType<typeof createTestDb>> = [];

  afterEach(async () => {
    await Promise.all(databases.splice(0).map((database) => database.destroy()));
  });

  it('keeps current local items until a next-renewal change becomes effective', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-07T10:00:00.000Z'));
    const storage = new KnexStorageDriver(database, clock);
    let scheduledChanges = 0;
    const payable = createPayable({
      providers: {
        revolut: new RevolutProvider({
          secretKey: 'revolut-secret',
          webhookSecret: 'revolut-webhook',
          environment: 'sandbox',
          fetch: revolutFetch(() => {
            scheduledChanges += 1;
          }),
        }),
      },
      storage,
      clock,
      idempotency: { store: new KnexIdempotencyRepository(database, clock) },
      tenant: { enabled: true },
    });
    const customer = payable.customer(billable, 'revolut', 'tenant_revolut');
    await customer.newSubscription('default').price('price_old').create();
    const manager = customer.subscription('default');
    const preview = await manager.previewChange({
      priceId: 'price_new',
      effectiveTiming: 'nextRenewal',
      prorationPolicy: 'none',
      paymentFailurePolicy: 'applyChange',
      idempotencyKey: 'preview-revolut-scheduled',
    });

    const applied = await manager.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-revolut-scheduled',
    });
    const replayed = await manager.applyChange({
      previewToken: preview.previewToken,
      idempotencyKey: 'apply-revolut-scheduled-replay',
    });
    const items = await storage.subscriptionItems.listBySubscription(applied.id, 'tenant_revolut');

    expect(applied.priceId).toBe('price_old');
    expect(applied.quantity).toBe(1);
    expect(replayed.priceId).toBe('price_old');
    expect(scheduledChanges).toBe(1);
    expect(items).toMatchObject([{ priceId: 'price_old', quantity: 1 }]);
  });

  it('keeps the current local price after a direct next-renewal swap', async () => {
    const database = createTestDb();
    databases.push(database);
    await migrate(database);
    const clock = new FakeClock(new Date('2026-08-07T10:00:00.000Z'));
    const storage = new KnexStorageDriver(database, clock);
    let scheduledChanges = 0;
    const payable = createPayable({
      providers: {
        revolut: new RevolutProvider({
          secretKey: 'revolut-secret',
          webhookSecret: 'revolut-webhook',
          environment: 'sandbox',
          fetch: revolutFetch(() => {
            scheduledChanges += 1;
          }),
        }),
      },
      storage,
      clock,
      tenant: { enabled: true },
    });
    const customer = payable.customer(billable, 'revolut', 'tenant_revolut');
    await customer.newSubscription('default').price('price_old').create();

    const swapped = await customer.subscription('default').swap({
      priceId: 'price_new',
      effectiveTiming: 'nextRenewal',
      prorationPolicy: 'none',
      paymentFailurePolicy: 'applyChange',
    });
    const items = await storage.subscriptionItems.listBySubscription(swapped.id, 'tenant_revolut');

    expect(swapped.priceId).toBe('price_old');
    expect(scheduledChanges).toBe(1);
    expect(items).toMatchObject([{ priceId: 'price_old', quantity: 1 }]);
  });
});
