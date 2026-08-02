import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveCatalogProviderKey } from '../src/application/services/catalog/catalog-idempotency-key';
import { createPayable } from '../src/create-payable';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';
import { createTestDb } from './support/knex';

const NOW = new Date('2026-08-02T00:00:00.000Z');

class PriceIdempotencyProvider extends FakeProvider {
  createCalls = 0;
  createContexts: OperationContext[] = [];

  override async createPrice(
    input: CreatePriceInput,
    context?: OperationContext,
  ): Promise<PriceDTO> {
    this.createCalls += 1;
    if (context) {
      this.createContexts.push(context);
    }
    return {
      providerPriceId: `price_${this.createCalls}`,
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
      intervalCount: input.intervalCount ?? null,
      description: input.description ?? null,
      active: true,
    };
  }
}

class FailingCatalogStorage extends KnexStorageDriver {
  override async transaction<T>(_work: (repositories: Repositories) => Promise<T>): Promise<T> {
    throw new Error('catalog persistence unavailable');
  }
}

class TrackingIdempotencyStore extends InMemoryIdempotencyStore {
  findCalls = 0;

  override async find(key: string, tenantId?: string | null) {
    this.findCalls += 1;
    return super.find(key, tenantId);
  }
}

function payableFor(
  providers: Record<string, PriceIdempotencyProvider>,
  store: InMemoryIdempotencyStore,
  storage?: KnexStorageDriver,
  authorizationEnabled = false,
) {
  return createPayable({
    providers,
    storage,
    clock: new FakeClock(NOW),
    idempotency: { store },
    authorization: { enabled: authorizationEnabled },
    tenant: { enabled: true },
  });
}

const priceInput: CreatePriceInput = {
  providerProductId: 'prod_fake',
  unitAmount: Money.of(9900, 'USD'),
  interval: 'month',
  intervalCount: 1,
  description: 'Monthly plan',
};

describe('price mutation idempotency', () => {
  let database: Knex | undefined;

  afterEach(async () => {
    await database?.destroy();
    database = undefined;
  });

  it('replays all price mutations without repeating provider work and revives Money', async () => {
    const provider = new PriceIdempotencyProvider();
    const prices = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).prices(
      'stripe',
      'tenant-a',
    );

    const created = await prices.create(priceInput, { idempotencyKey: 'create-1' });
    const replay = await prices.create(priceInput, { idempotencyKey: 'create-1' });
    const archived = await prices.archive(created.providerPriceId, {
      idempotencyKey: 'archive-1',
    });
    const archiveReplay = await prices.archive(created.providerPriceId, {
      idempotencyKey: 'archive-1',
    });
    const activated = await prices.activate(created.providerPriceId, {
      idempotencyKey: 'activate-1',
    });
    const activateReplay = await prices.activate(created.providerPriceId, {
      idempotencyKey: 'activate-1',
    });

    expect(replay.unitAmount).toBeInstanceOf(Money);
    expect(replay.unitAmount.amount()).toBe(9900);
    expect(replay.unitAmount.currency()).toBe('USD');
    expect(archiveReplay.providerPriceId).toBe(archived.providerPriceId);
    expect(archiveReplay.active).toBe(false);
    expect(archiveReplay.unitAmount.amount()).toBe(archived.unitAmount.amount());
    expect(activateReplay.providerPriceId).toBe(activated.providerPriceId);
    expect(activateReplay.active).toBe(true);
    expect(activateReplay.unitAmount.amount()).toBe(activated.unitAmount.amount());
    expect(provider.createCalls).toBe(1);
    expect(provider.priceActiveCalls).toHaveLength(2);
  });

  it('rejects a changed create request that reuses a key', async () => {
    const provider = new PriceIdempotencyProvider();
    const prices = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).prices(
      'stripe',
      'tenant-a',
    );

    await prices.create(priceInput, { idempotencyKey: 'conflict' });
    await expect(
      prices.create(
        { ...priceInput, unitAmount: Money.of(19_900, 'USD') },
        { idempotencyKey: 'conflict' },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.createCalls).toBe(1);
  });

  it('runs identical create requests again when their keys differ', async () => {
    const provider = new PriceIdempotencyProvider();
    const prices = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).prices(
      'stripe',
      'tenant-a',
    );

    await prices.create(priceInput, { idempotencyKey: 'create-a' });
    await prices.create(priceInput, { idempotencyKey: 'create-b' });

    expect(provider.createCalls).toBe(2);
  });

  it('isolates the same key by tenant, provider, and action', async () => {
    const stripe = new PriceIdempotencyProvider();
    const paddle = new PriceIdempotencyProvider();
    const payable = payableFor({ stripe, paddle }, new InMemoryIdempotencyStore());

    await payable.prices('stripe', 'tenant-a').create(priceInput, { idempotencyKey: 'same' });
    await payable.prices('stripe', 'tenant-b').create(priceInput, { idempotencyKey: 'same' });
    await payable.prices('paddle', 'tenant-a').create(priceInput, { idempotencyKey: 'same' });
    await payable.prices('stripe', 'tenant-a').archive('price_1', { idempotencyKey: 'same' });

    expect(stripe.createCalls).toBe(2);
    expect(paddle.createCalls).toBe(1);
    expect(stripe.priceActiveCalls).toHaveLength(1);
    expect(stripe.createContexts[0]?.idempotencyKey).not.toBe(
      stripe.createContexts[1]?.idempotencyKey,
    );
    expect(stripe.createContexts[0]?.idempotencyKey).not.toBe(
      paddle.createContexts[0]?.idempotencyKey,
    );
  });

  it('allows only one provider call for concurrent equal creates', async () => {
    const provider = new PriceIdempotencyProvider();
    const prices = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).prices(
      'stripe',
      'tenant-a',
    );

    const outcomes = await Promise.allSettled([
      prices.create(priceInput, { idempotencyKey: 'concurrent' }),
      prices.create(priceInput, { idempotencyKey: 'concurrent' }),
    ]);

    expect(provider.createCalls).toBe(1);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).not.toHaveLength(0);
    const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
    if (rejection?.status === 'rejected') {
      expect(rejection.reason).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    }
  });

  it('checks authorization before reading idempotency state', async () => {
    const provider = new PriceIdempotencyProvider();
    const store = new TrackingIdempotencyStore();
    const prices = payableFor({ stripe: provider }, store, undefined, true).prices(
      'stripe',
      'tenant-a',
    );

    await expect(
      prices.create(priceInput, {
        idempotencyKey: 'denied',
        authorization: { allowed: false, actorId: 'viewer' },
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(store.findCalls).toBe(0);
    expect(provider.createCalls).toBe(0);
  });

  it('protects product resolution and durable persistence during create replay', async () => {
    database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock(NOW));
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_fake',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    let productLookups = 0;
    const products = storage.products;
    storage.products = {
      create: (data) => products.create(data),
      update: (id, patch, tenantId) => products.update(id, patch, tenantId),
      findById: (id, tenantId) => products.findById(id, tenantId),
      findByProviderId: (provider, providerProductId, tenantId) => {
        productLookups += 1;
        return products.findByProviderId(provider, providerProductId, tenantId);
      },
    };
    const provider = new PriceIdempotencyProvider();
    const prices = payableFor({ stripe: provider }, new InMemoryIdempotencyStore(), storage).prices(
      'stripe',
      'tenant-a',
    );

    await prices.create(priceInput, { idempotencyKey: 'durable' });
    await prices.create(priceInput, { idempotencyKey: 'durable' });

    expect(productLookups).toBe(1);
    expect(provider.createCalls).toBe(1);
    expect(await storage.auditLogs.list({ resourceType: 'price' })).toHaveLength(1);
    expect(await database('payable_outbox_events')).toHaveLength(1);
  });

  it('does not complete the key when durable price persistence fails', async () => {
    database = createTestDb();
    await migrate(database);
    const provider = new PriceIdempotencyProvider();
    const store = new InMemoryIdempotencyStore();
    const storage = new FailingCatalogStorage(database, new FakeClock(NOW));
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_fake',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    const prices = payableFor({ stripe: provider }, store, storage).prices('stripe', 'tenant-a');

    await expect(
      prices.create(priceInput, { idempotencyKey: 'persistence-failure' }),
    ).rejects.toMatchObject({ code: 'CATALOG_PERSISTENCE_FAILED' });

    const storageKey = await deriveCatalogProviderKey({
      tenantId: 'tenant-a',
      providerName: 'stripe',
      action: 'price.create',
      callerKey: 'persistence-failure',
    });
    expect(await store.find(storageKey, 'tenant-a')).toMatchObject({ status: 'failed' });
  });
});
