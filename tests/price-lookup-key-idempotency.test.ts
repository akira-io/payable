import type { Knex } from 'knex';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveCatalogProviderKey } from '../src/application/services/catalog/catalog-idempotency-key';
import { revivePrice } from '../src/application/services/catalog/catalog-idempotency-result';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type {
  CreatePriceInput,
  PriceDTO,
  TransferPriceLookupKeyInput,
} from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { hashRequest } from '../src/support/hash/request-hash';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';
import { createTestDb } from './support/knex';

const NOW = new Date('2026-08-03T00:00:00.000Z');

class TransferProvider extends FakeProvider {
  createCalls = 0;
  transferCalls = 0;
  contexts: OperationContext[] = [];

  constructor() {
    super();
    this.supportedCapabilities.add('priceLookupKeys');
  }

  override async createPrice(input: CreatePriceInput): Promise<PriceDTO> {
    this.createCalls += 1;
    this.lastCreatePrice = input;
    return {
      providerPriceId: `price_${this.createCalls}`,
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
      intervalCount: input.intervalCount ?? null,
      description: input.description ?? null,
      active: true,
      lookupKey: input.lookupKey ?? null,
    };
  }

  async transferPriceLookupKey(
    input: TransferPriceLookupKeyInput,
    context: OperationContext,
  ): Promise<PriceDTO> {
    this.transferCalls += 1;
    this.contexts.push(context);
    return {
      providerPriceId: input.providerPriceId,
      providerProductId: 'prod_1',
      unitAmount: Money.of(1000, 'USD'),
      interval: null,
      intervalCount: null,
      description: null,
      active: true,
      lookupKey: input.lookupKey,
    };
  }
}

function resource(
  provider: TransferProvider,
  store?: InMemoryIdempotencyStore,
  storage?: KnexStorageDriver,
) {
  return createPayable({
    providers: { stripe: provider },
    clock: new FakeClock(NOW),
    idempotency: store ? { store } : undefined,
    storage,
    tenant: { enabled: true },
  }).prices('stripe', 'tenant-a');
}

describe('price lookup key transfer idempotency', () => {
  let database: Knex | undefined;

  afterEach(async () => {
    await database?.destroy();
    database = undefined;
  });

  it('replays an identical transfer with the provider-derived key and no extra provider work', async () => {
    const provider = new TransferProvider();
    const prices = resource(provider, new InMemoryIdempotencyStore());
    const input = { providerPriceId: 'price_new', lookupKey: 'monthly' };

    const first = await prices.transferLookupKey(input, { idempotencyKey: 'transfer-1' });
    const replay = await prices.transferLookupKey(input, { idempotencyKey: 'transfer-1' });

    expect(first).toMatchObject({ providerPriceId: 'price_new', lookupKey: 'monthly' });
    expect(replay).toMatchObject({ providerPriceId: 'price_new', lookupKey: 'monthly' });
    expect(provider.transferCalls).toBe(1);
    expect(provider.contexts[0]?.idempotencyKey).toBe(
      await deriveCatalogProviderKey({
        tenantId: 'tenant-a',
        providerName: 'stripe',
        action: 'price.lookup-key.transfer',
        callerKey: 'transfer-1',
      }),
    );
  });

  it('replays create retries when false transferLookupKey is omitted or explicit', async () => {
    const provider = new TransferProvider();
    const prices = resource(provider, new InMemoryIdempotencyStore());
    const input = { providerProductId: 'prod_1', unitAmount: Money.of(1000, 'USD') };

    const created = await prices.create(input, { idempotencyKey: 'price-1' });

    const replay = await prices.create(
      { ...input, transferLookupKey: false },
      { idempotencyKey: 'price-1' },
    );

    expect(replay).toMatchObject({ providerPriceId: created.providerPriceId });
    expect(provider.createCalls).toBe(1);
    expect(provider.lastCreatePrice).not.toHaveProperty('transferLookupKey');
  });

  it('conflicts when a caller key is reused for another transfer target or lookup key', async () => {
    const provider = new TransferProvider();
    const prices = resource(provider, new InMemoryIdempotencyStore());

    await prices.transferLookupKey(
      { providerPriceId: 'price_new', lookupKey: 'monthly' },
      { idempotencyKey: 'transfer-1' },
    );
    await expect(
      prices.transferLookupKey(
        { providerPriceId: 'price_other', lookupKey: 'yearly' },
        { idempotencyKey: 'transfer-1' },
      ),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.transferCalls).toBe(1);
  });

  it('hashes the transfer action together with its input', async () => {
    const provider = new TransferProvider();
    const store = new InMemoryIdempotencyStore();
    const input = { providerPriceId: 'price_new', lookupKey: 'monthly' };

    await resource(provider, store).transferLookupKey(input, { idempotencyKey: 'transfer-1' });

    const storageKey = await deriveCatalogProviderKey({
      tenantId: 'tenant-a',
      providerName: 'stripe',
      action: 'price.lookup-key.transfer',
      callerKey: 'transfer-1',
    });
    expect((await store.find(storageKey, 'tenant-a'))?.requestHash).toBe(
      await hashRequest({ action: 'price.lookup-key.transfer', input }),
    );
  });

  it('requires idempotency storage before a non-native provider transfer', async () => {
    const provider = new TransferProvider();
    provider.supportedCapabilities.delete('catalogIdempotency');

    await expect(
      resource(provider).transferLookupKey(
        { providerPriceId: 'price_new', lookupKey: 'monthly' },
        { idempotencyKey: 'transfer-1' },
      ),
    ).rejects.toMatchObject({ code: 'CATALOG_IDEMPOTENCY_STORAGE_REQUIRED' });
    expect(provider.transferCalls).toBe(0);
  });

  it('revives a legacy transfer result with a null lookup key', () => {
    const result = revivePrice({
      providerPriceId: 'price_new',
      providerProductId: 'prod_1',
      unitAmount: { amount: 1000, currency: 'USD' },
      interval: null,
      intervalCount: null,
      description: null,
      active: true,
    });

    expect(result.lookupKey).toBeNull();
  });

  it('does not persist an alias-only transfer or mutate the prior catalog price', async () => {
    database = createTestDb();
    await migrate(database);
    const storage = new KnexStorageDriver(database, new FakeClock(NOW));
    await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_1',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    const product = await storage.products.findByProviderId('stripe', 'prod_1', 'tenant-a');
    if (!product) {
      throw new Error('Seed product was not created');
    }
    const oldPrice = await storage.prices.create({
      tenantId: 'tenant-a',
      productId: product.id,
      provider: 'stripe',
      providerPriceId: 'price_old',
      unitAmount: 1000,
      currency: 'USD',
      interval: null,
      intervalCount: null,
      active: true,
    });
    const provider = new TransferProvider();
    const prices = resource(provider, new InMemoryIdempotencyStore(), storage);

    const transferred = await prices.transferLookupKey(
      { providerPriceId: 'price_new', lookupKey: 'monthly' },
      { idempotencyKey: 'transfer-1' },
    );

    expect(transferred.lookupKey).toBe('monthly');
    expect(await storage.prices.findById(oldPrice.id, 'tenant-a')).toMatchObject({ active: true });
    expect(await storage.prices.findByProviderId('stripe', 'price_new', 'tenant-a')).toBeNull();
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await database('payable_outbox_events')).toEqual([]);
  });
});
