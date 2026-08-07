import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class TrackingPriceProvider extends FakeProvider {
  createPriceCalls = 0;
  createPriceContext?: OperationContext;
  createPriceError?: Error;

  override async createPrice(
    input: CreatePriceInput,
    context?: OperationContext,
  ): Promise<PriceDTO> {
    this.createPriceCalls += 1;
    this.createPriceContext = context;
    if (this.createPriceError) {
      throw this.createPriceError;
    }
    return super.createPrice(input);
  }
}

describe('price mutation persistence', () => {
  let db: Knex;
  let storage: KnexStorageDriver;
  let provider: TrackingPriceProvider;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    provider = new TrackingPriceProvider();
    storage = new KnexStorageDriver(db, new FakeClock(new Date('2026-08-01T00:00:00.000Z')));
  });

  afterEach(async () => {
    await db.destroy();
  });

  function payableWithStorage() {
    return createPayable({
      providers: { registered: provider },
      storage,
      clock: new FakeClock(new Date('2026-08-01T00:00:00.000Z')),
    });
  }

  async function seedLocalProduct(): Promise<string> {
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    return product.id;
  }

  async function outboxRows(): Promise<Record<string, unknown>[]> {
    return db('payable_outbox_events').orderBy('created_at');
  }

  it('persists a created price with complete audit and outbox records', async () => {
    const productId = await seedLocalProduct();
    const payable = payableWithStorage();

    const price = await payable.providerCatalog('registered', 'tenant-a').prices.create(
      {
        providerProductId: 'prod_fake',
        unitAmount: Money.of(12900, 'USD'),
        interval: 'month',
        intervalCount: 1,
        description: 'Monthly plan',
      },
      {
        authorization: { allowed: true, actorType: 'service', actorId: 'catalog-admin' },
      },
    );

    const localPrice = await storage.prices.findByProviderId(
      'registered',
      price.providerPriceId,
      'tenant-a',
    );
    expect(localPrice).toMatchObject({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerPriceId: 'price_fake',
      productId,
      currency: 'USD',
      unitAmount: 12900,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
    const auditLogs = await storage.auditLogs.list({ resourceType: 'price' });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]).toMatchObject({
      tenantId: 'tenant-a',
      correlationId: provider.createPriceContext?.correlationId,
      actorType: 'service',
      actorId: 'catalog-admin',
      action: 'price.created',
      resourceType: 'price',
      resourceId: localPrice?.id,
      before: null,
      after: {
        id: localPrice?.id,
        tenantId: 'tenant-a',
        provider: 'registered',
        providerPriceId: 'price_fake',
        productId,
        currency: 'USD',
        unitAmount: 12900,
        interval: 'month',
        intervalCount: 1,
        active: true,
      },
      metadata: { provider: 'registered', providerResourceId: 'price_fake' },
      ipAddress: null,
      userAgent: null,
    });
    const outbox = await outboxRows();
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({
      tenant_id: 'tenant-a',
      correlation_id: provider.createPriceContext?.correlationId,
      event_type: 'price.created.v1',
      event_version: 1,
      dedupe_key: `catalog:price:price.create:registered:price_fake:${provider.createPriceContext?.correlationId}`,
    });
    expect(JSON.parse(outbox[0]?.payload as string)).toEqual({
      action: 'price.create',
      resourceType: 'price',
      resourceId: localPrice?.id,
      provider: 'registered',
      providerResourceId: 'price_fake',
      tenantId: 'tenant-a',
      state: auditLogs[0]?.after,
    });
    expect(price.description).toBe('Monthly plan');
  });

  it('rejects a missing local product before calling the provider', async () => {
    const payable = payableWithStorage();

    await expect(
      payable.providerCatalog('registered', 'tenant-a').prices.create({
        providerProductId: 'prod_missing',
        unitAmount: Money.of(12900, 'USD'),
      }),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    expect(provider.createPriceCalls).toBe(0);
    expect(await db('payable_prices')).toEqual([]);
    expect(await storage.auditLogs.list({ resourceType: 'price' })).toEqual([]);
    expect(await outboxRows()).toEqual([]);
  });

  it('persists archive and activate states with matching transitions', async () => {
    await seedLocalProduct();
    const payable = payableWithStorage();
    const prices = payable.providerCatalog('registered', 'tenant-a').prices;
    await prices.create({ providerProductId: 'prod_fake', unitAmount: Money.of(12900, 'USD') });

    await prices.archive('price_fake');
    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({ active: false });
    await prices.activate('price_fake');
    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({ active: true });

    expect((await outboxRows()).map((row) => row.event_type)).toEqual([
      'price.created.v1',
      'price.archived.v1',
      'price.activated.v1',
    ]);
    expect(
      (await storage.auditLogs.list({ resourceType: 'price' })).map((row) => row.action).sort(),
    ).toEqual(['price.activated', 'price.archived', 'price.created']);
  });

  it('restores a missing local price from a lifecycle response', async () => {
    const productId = await seedLocalProduct();
    const payable = payableWithStorage();

    const restored = await payable
      .providerCatalog('registered', 'tenant-a')
      .prices.archive('price_fake');

    expect(restored.active).toBe(false);
    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({ productId, active: false, unitAmount: 9900, currency: 'USD' });
    expect((await outboxRows()).map((row) => row.event_type)).toEqual(['price.archived.v1']);
  });

  it('does not duplicate transitions for identical provider state', async () => {
    await seedLocalProduct();
    const prices = payableWithStorage().providerCatalog('registered', 'tenant-a').prices;
    const input = { providerProductId: 'prod_fake', unitAmount: Money.of(12900, 'USD') };

    await prices.create(input);
    await prices.create(input);

    expect(await storage.auditLogs.list({ resourceType: 'price' })).toHaveLength(1);
    expect(await outboxRows()).toHaveLength(1);
  });

  it('leaves local price transitions untouched when the provider fails', async () => {
    await seedLocalProduct();
    provider.createPriceError = new Error('provider unavailable');
    const payable = payableWithStorage();

    await expect(
      payable.providerCatalog('registered', 'tenant-a').prices.create({
        providerProductId: 'prod_fake',
        unitAmount: Money.of(12900, 'USD'),
      }),
    ).rejects.toThrow('provider unavailable');

    expect(await db('payable_prices')).toEqual([]);
    expect(await storage.auditLogs.list({ resourceType: 'price' })).toEqual([]);
    expect(await outboxRows()).toEqual([]);
  });

  it('keeps all price mutations provider-only without storage', async () => {
    const payable = createPayable({ providers: { registered: provider } });
    const prices = payable.providerCatalog('registered', 'tenant-a').prices;

    const created = await prices.create({
      providerProductId: 'prod_missing',
      unitAmount: Money.of(12900, 'USD'),
    });
    const archived = await prices.archive(created.providerPriceId);
    const activated = await prices.activate(created.providerPriceId);

    expect([created.active, archived.active, activated.active]).toEqual([true, false, true]);
    expect(provider.createPriceCalls).toBe(1);
    expect(provider.priceActiveCalls).toHaveLength(2);
  });
});
