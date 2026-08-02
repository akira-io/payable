import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveCatalogProviderKey } from '../src/application/services/catalog/catalog-idempotency-key';
import { createPayable } from '../src/create-payable';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../src/domain/dtos/product.dto';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';
import { createTestDb } from './support/knex';

const NOW = new Date('2026-08-02T00:00:00.000Z');

class ProductIdempotencyProvider extends FakeProvider {
  createCalls = 0;
  updateCalls = 0;
  createContexts: OperationContext[] = [];
  updateContexts: OperationContext[] = [];

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.createCalls += 1;
    if (context) {
      this.createContexts.push(context);
    }
    return {
      providerProductId: `prod_${this.createCalls}`,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    };
  }

  override async updateProduct(
    input: UpdateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.updateCalls += 1;
    if (context) {
      this.updateContexts.push(context);
    }
    return {
      providerProductId: input.providerProductId,
      name: input.name ?? 'Product',
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: { updated: 'true' },
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
  providers: Record<string, ProductIdempotencyProvider>,
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

describe('product mutation idempotency', () => {
  let database: Knex | undefined;

  afterEach(async () => {
    await database?.destroy();
    database = undefined;
  });

  it('replays all four product mutations without repeating provider work', async () => {
    const provider = new ProductIdempotencyProvider();
    const products = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).products(
      'stripe',
      'tenant-a',
    );

    const created = await products.create({ name: 'Pro' }, { idempotencyKey: 'create-1' });
    expect(await products.create({ name: 'Pro' }, { idempotencyKey: 'create-1' })).toEqual(created);
    const updated = await products.update(
      { providerProductId: created.providerProductId, name: 'Pro v2' },
      { idempotencyKey: 'update-1' },
    );
    expect(
      await products.update(
        { providerProductId: created.providerProductId, name: 'Pro v2' },
        { idempotencyKey: 'update-1' },
      ),
    ).toEqual(updated);
    const archived = await products.archive(created.providerProductId, {
      idempotencyKey: 'archive-1',
    });
    expect(
      await products.archive(created.providerProductId, { idempotencyKey: 'archive-1' }),
    ).toEqual(archived);
    const activated = await products.activate(created.providerProductId, {
      idempotencyKey: 'activate-1',
    });
    expect(
      await products.activate(created.providerProductId, { idempotencyKey: 'activate-1' }),
    ).toEqual(activated);

    expect(provider.createCalls).toBe(1);
    expect(provider.updateCalls).toBe(1);
    expect(provider.productActiveCalls).toHaveLength(2);
  });

  it('rejects changed create and update requests that reuse a key', async () => {
    const provider = new ProductIdempotencyProvider();
    const products = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).products(
      'stripe',
      'tenant-a',
    );

    await products.create({ name: 'Pro' }, { idempotencyKey: 'create-conflict' });
    await expect(
      products.create({ name: 'Enterprise' }, { idempotencyKey: 'create-conflict' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await products.update(
      { providerProductId: 'prod_1', name: 'Pro v2' },
      { idempotencyKey: 'update-conflict' },
    );
    await expect(
      products.update(
        { providerProductId: 'prod_1', name: 'Enterprise' },
        { idempotencyKey: 'update-conflict' },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  });

  it('runs identical create requests again when their keys differ', async () => {
    const provider = new ProductIdempotencyProvider();
    const products = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).products(
      'stripe',
      'tenant-a',
    );

    await products.create({ name: 'Pro' }, { idempotencyKey: 'create-a' });
    await products.create({ name: 'Pro' }, { idempotencyKey: 'create-b' });

    expect(provider.createCalls).toBe(2);
  });

  it('isolates the same key by tenant and derives different provider keys', async () => {
    const provider = new ProductIdempotencyProvider();
    const payable = payableFor({ stripe: provider }, new InMemoryIdempotencyStore());

    await payable
      .products('stripe', 'tenant-a')
      .create({ name: 'Pro' }, { idempotencyKey: 'same' });
    await payable
      .products('stripe', 'tenant-b')
      .create({ name: 'Pro' }, { idempotencyKey: 'same' });

    expect(provider.createCalls).toBe(2);
    expect(provider.createContexts[0]?.idempotencyKey).not.toBe(
      provider.createContexts[1]?.idempotencyKey,
    );
  });

  it('isolates the same key by provider and operation', async () => {
    const stripe = new ProductIdempotencyProvider();
    const paddle = new ProductIdempotencyProvider();
    const payable = payableFor({ stripe, paddle }, new InMemoryIdempotencyStore());

    await payable
      .products('stripe', 'tenant-a')
      .create({ name: 'Pro' }, { idempotencyKey: 'same' });
    await payable
      .products('paddle', 'tenant-a')
      .create({ name: 'Pro' }, { idempotencyKey: 'same' });
    await payable.products('stripe', 'tenant-a').archive('prod_1', { idempotencyKey: 'same' });

    expect(stripe.createCalls).toBe(1);
    expect(paddle.createCalls).toBe(1);
    expect(stripe.productActiveCalls).toHaveLength(1);
    expect(stripe.createContexts[0]?.idempotencyKey).not.toBe(
      paddle.createContexts[0]?.idempotencyKey,
    );
  });

  it('allows only one provider call for concurrent equal creates', async () => {
    const provider = new ProductIdempotencyProvider();
    const products = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).products(
      'stripe',
      'tenant-a',
    );

    const executions = await Promise.allSettled([
      products.create({ name: 'Pro' }, { idempotencyKey: 'concurrent' }),
      products.create({ name: 'Pro' }, { idempotencyKey: 'concurrent' }),
    ]);

    expect(provider.createCalls).toBe(1);
    expect(executions.filter((execution) => execution.status === 'fulfilled')).not.toHaveLength(0);
    const rejection = executions.find((execution) => execution.status === 'rejected');
    if (rejection?.status === 'rejected') {
      expect(rejection.reason).toMatchObject({ code: 'IDEMPOTENCY_IN_PROGRESS' });
    }
  });

  it('checks authorization before reading idempotency state', async () => {
    const provider = new ProductIdempotencyProvider();
    const store = new TrackingIdempotencyStore();
    const products = payableFor({ stripe: provider }, store, undefined, true).products(
      'stripe',
      'tenant-a',
    );

    await expect(
      products.create(
        { name: 'Pro' },
        { idempotencyKey: 'denied', authorization: { allowed: false, actorId: 'viewer' } },
      ),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(store.findCalls).toBe(0);
    expect(provider.createCalls).toBe(0);
  });

  it('does not complete the key when durable product persistence fails', async () => {
    database = createTestDb();
    await migrate(database);
    const provider = new ProductIdempotencyProvider();
    const store = new InMemoryIdempotencyStore();
    const storage = new FailingCatalogStorage(database, new FakeClock(NOW));
    const products = payableFor({ stripe: provider }, store, storage).products(
      'stripe',
      'tenant-a',
    );

    await expect(
      products.create({ name: 'Pro' }, { idempotencyKey: 'persistence-failure' }),
    ).rejects.toMatchObject({ code: 'CATALOG_PERSISTENCE_FAILED' });

    const storageKey = await deriveCatalogProviderKey({
      tenantId: 'tenant-a',
      providerName: 'stripe',
      action: 'product.create',
      callerKey: 'persistence-failure',
    });
    expect(await store.find(storageKey, 'tenant-a')).toMatchObject({ status: 'failed' });
  });

  it('replays the complete product DTO', async () => {
    const provider = new ProductIdempotencyProvider();
    const products = payableFor({ stripe: provider }, new InMemoryIdempotencyStore()).products(
      'stripe',
      'tenant-a',
    );
    const input = {
      name: 'Pro',
      description: 'Monthly plan',
      active: false,
      metadata: { tier: 'pro', region: 'global' },
    };

    await products.create(input, { idempotencyKey: 'full-dto' });
    const replay = await products.create(input, { idempotencyKey: 'full-dto' });

    expect(replay).toEqual({ providerProductId: 'prod_1', ...input });
    expect(provider.createCalls).toBe(1);
  });
});
