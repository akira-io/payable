import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { PriceDTO } from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { coordinateNextPriceReads } from './support/coordinated-price-storage';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class DivergentPriceProvider extends FakeProvider {
  override async setPriceActive(
    id: string,
    active: boolean,
    context: OperationContext,
  ): Promise<PriceDTO> {
    const price = await super.setPriceActive(id, active, context);
    return {
      ...price,
      unitAmount: Money.of(active ? 2000 : 3000, 'USD'),
    };
  }
}

describe('price mutation concurrency', () => {
  let db: Knex;
  let storage: KnexStorageDriver;

  beforeEach(async () => {
    db = createTestDb();
    await migrate(db);
    storage = new KnexStorageDriver(db, new FakeClock());
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      name: 'Pro',
      description: null,
      active: true,
      metadata: null,
    });
    await storage.prices.create({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerPriceId: 'price_fake',
      productId: product.id,
      currency: 'USD',
      unitAmount: 1000,
      interval: 'month',
      intervalCount: 1,
      active: true,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  function payableForConcurrentReads(provider: FakeProvider = new FakeProvider()) {
    return createPayable({
      providers: { registered: provider },
      storage: coordinateNextPriceReads(storage),
    });
  }

  async function expectOneTransition(): Promise<void> {
    expect(await storage.auditLogs.list({ resourceType: 'price' })).toHaveLength(1);
    expect(await db('payable_outbox_events')).toHaveLength(1);
  }

  it('emits one transition when concurrent lifecycle responses converge', async () => {
    const prices = payableForConcurrentReads().providerCatalog('registered', 'tenant-a').prices;

    await Promise.all([prices.archive('price_fake'), prices.archive('price_fake')]);

    await expectOneTransition();
    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({ active: false });
  });

  it('rejects a divergent loser without emitting a stale transition', async () => {
    const prices = payableForConcurrentReads(new DivergentPriceProvider()).providerCatalog(
      'registered',
      'tenant-a',
    ).prices;

    const outcomes = await Promise.allSettled([
      prices.activate('price_fake'),
      prices.archive('price_fake'),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    await expectOneTransition();
    const stored = await storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a');
    expect([2000, 3000]).toContain(stored?.unitAmount);
  });
});
