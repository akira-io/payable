import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import type {
  CatalogMutationAction,
  CatalogMutationOptions,
  Payable,
  ProviderCapabilityValue,
} from '../src/index';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

type MutationCase = {
  action: CatalogMutationAction;
  label: string;
  capability: ProviderCapabilityValue;
  run: (payable: Payable, options?: CatalogMutationOptions) => Promise<unknown>;
};

const mutations: MutationCase[] = [
  {
    action: 'product.create',
    label: 'create product',
    capability: 'catalog',
    run: (payable, options) => payable.products().create({ name: 'Pro' }, options),
  },
  {
    action: 'product.update',
    label: 'update product',
    capability: 'catalog',
    run: (payable, options) =>
      payable.products().update({ providerProductId: 'prod_fake', name: 'Pro v2' }, options),
  },
  {
    action: 'product.activate',
    label: 'activate product',
    capability: 'catalogLifecycle',
    run: (payable, options) => payable.products().activate('prod_fake', options),
  },
  {
    action: 'product.archive',
    label: 'archive product',
    capability: 'catalogLifecycle',
    run: (payable, options) => payable.products().archive('prod_fake', options),
  },
  {
    action: 'price.create',
    label: 'create price',
    capability: 'catalog',
    run: (payable, options) =>
      payable
        .prices()
        .create({ providerProductId: 'prod_fake', unitAmount: Money.of(9900, 'USD') }, options),
  },
  {
    action: 'price.activate',
    label: 'activate price',
    capability: 'catalogLifecycle',
    run: (payable, options) => payable.prices().activate('price_fake', options),
  },
  {
    action: 'price.archive',
    label: 'archive price',
    capability: 'catalogLifecycle',
    run: (payable, options) => payable.prices().archive('price_fake', options),
  },
];

function providerMutationCount(provider: FakeProvider): number {
  return [
    provider.lastCreateProduct,
    provider.lastUpdateProduct,
    provider.lastCreatePrice,
    ...provider.productActiveCalls,
    ...provider.priceActiveCalls,
  ].filter((mutation) => mutation !== undefined).length;
}

async function expectStorageUntouched(db: Knex): Promise<void> {
  for (const table of [
    'payable_products',
    'payable_prices',
    'payable_audit_logs',
    'payable_outbox_events',
  ]) {
    expect(await db(table)).toEqual([]);
  }
}

async function setup(authorizationEnabled: boolean) {
  const db = createTestDb();
  await migrate(db);
  const provider = new FakeProvider();
  const clock = new FakeClock(new Date('2026-08-01T00:00:00.000Z'));
  const payable = createPayable({
    providers: { stripe: provider },
    storage: new KnexStorageDriver(db, clock),
    clock,
    authorization: { enabled: authorizationEnabled },
  });

  return { db, payable, provider };
}

describe('catalog mutation authorization', () => {
  it.each(
    mutations,
  )('denies %s without an authorization context before capability checks', async (mutation) => {
    const { db, payable, provider } = await setup(true);
    provider.supportedCapabilities.delete(mutation.capability);

    await expect(mutation.run(payable)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
      message: `Not authorized to ${mutation.label}`,
      context: { action: mutation.action },
    });
    expect(providerMutationCount(provider)).toBe(0);
    await expectStorageUntouched(db);
    await db.destroy();
  });

  it.each(
    mutations,
  )('denies %s with a denied context before capability checks', async (mutation) => {
    const { db, payable, provider } = await setup(true);
    provider.supportedCapabilities.delete(mutation.capability);

    await expect(
      mutation.run(payable, {
        authorization: {
          allowed: false,
          actorId: 'catalog-viewer',
          actorType: 'service',
          tenantId: 'tenant-a',
        },
      }),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
      message: `Not authorized to ${mutation.label}`,
      context: { action: mutation.action },
    });
    expect(providerMutationCount(provider)).toBe(0);
    await expectStorageUntouched(db);
    await db.destroy();
  });

  it.each(mutations)('allows %s with an authorized context', async (mutation) => {
    const { db, payable, provider } = await setup(true);

    await mutation.run(payable, {
      authorization: {
        allowed: true,
        actorId: 'catalog-admin',
        actorType: 'service',
        tenantId: 'tenant-a',
      },
    });

    expect(providerMutationCount(provider)).toBe(1);
    await db.destroy();
  });

  it.each(
    mutations,
  )('denies %s with a denied explicit context when authorization is disabled', async (mutation) => {
    const { db, payable, provider } = await setup(false);
    provider.supportedCapabilities.delete(mutation.capability);

    await expect(
      mutation.run(payable, {
        authorization: { allowed: false, actorId: 'catalog-viewer' },
      }),
    ).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
      message: `Not authorized to ${mutation.label}`,
      context: { action: mutation.action },
    });
    expect(providerMutationCount(provider)).toBe(0);
    await expectStorageUntouched(db);
    await db.destroy();
  });

  it.each(
    mutations,
  )('allows %s with an authorized explicit context when authorization is disabled', async (mutation) => {
    const { db, payable, provider } = await setup(false);

    await mutation.run(payable, {
      authorization: { allowed: true, actorId: 'catalog-admin' },
    });

    expect(providerMutationCount(provider)).toBe(1);
    await db.destroy();
  });

  it.each(
    mutations,
  )('allows %s without options when authorization is disabled', async (mutation) => {
    const { db, payable, provider } = await setup(false);

    await mutation.run(payable);

    expect(providerMutationCount(provider)).toBe(1);
    await db.destroy();
  });
});
