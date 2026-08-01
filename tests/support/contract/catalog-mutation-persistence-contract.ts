import { expect, it } from 'vitest';
import { createPayable } from '../../../src/create-payable';
import type { CreateProductInput, ProductDTO } from '../../../src/domain/dtos/product.dto';
import { Money } from '../../../src/domain/value-objects/money';
import { withOutboxFailure } from '../catalog-recovery-storage';
import { FakeProvider } from '../fake-provider';
import type { ContractContext } from './harness';

class CountingCatalogProvider extends FakeProvider {
  productCreateCalls = 0;

  override async createProduct(input: CreateProductInput): Promise<ProductDTO> {
    this.productCreateCalls += 1;
    return super.createProduct(input);
  }
}

export function registerCatalogMutationPersistenceContract(context: ContractContext): void {
  it('persists all product mutations with the registered provider identity', async () => {
    const { storage, clock } = context.harness();
    const provider = new FakeProvider();
    const products = createPayable({
      providers: { registered: provider },
      storage,
      clock,
    }).products('registered', 'tenant-a');

    await products.create({ name: 'Pro' });
    await products.update({ providerProductId: 'prod_fake', name: 'Pro 2' });
    await products.archive('prod_fake');
    await products.activate('prod_fake');

    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toMatchObject({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerProductId: 'prod_fake',
      active: true,
    });
    const auditActions = (await storage.auditLogs.list({ tenantId: 'tenant-a' }))
      .map((entry) => entry.action)
      .sort();
    expect(auditActions).toEqual([
      'product.activated',
      'product.archived',
      'product.created',
      'product.updated',
    ]);
    const eventTypes = (await storage.outboxEvents.claimPending(10))
      .map((event) => event.eventType)
      .sort();
    expect(eventTypes).toEqual([
      'product.activated.v1',
      'product.archived.v1',
      'product.created.v1',
      'product.updated.v1',
    ]);
  });

  it('persists all price mutations with their local product link', async () => {
    const { storage, clock } = context.harness();
    const product = await createLocalProduct(context, 'tenant-a');
    const provider = new FakeProvider();
    provider.pricesPage = {
      data: [
        {
          providerPriceId: 'price_fake',
          providerProductId: 'prod_shared',
          unitAmount: Money.of(9900, 'USD'),
          interval: 'month',
          intervalCount: 1,
          description: null,
          active: true,
        },
      ],
      nextCursor: null,
    };
    const prices = createPayable({
      providers: { registered: provider },
      storage,
      clock,
    }).prices('registered', 'tenant-a');

    await prices.create({
      providerProductId: 'prod_shared',
      unitAmount: Money.of(9900, 'USD'),
      interval: 'month',
      intervalCount: 1,
    });
    await prices.archive('price_fake');
    await prices.activate('price_fake');

    await expect(
      storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a'),
    ).resolves.toMatchObject({
      tenantId: 'tenant-a',
      provider: 'registered',
      providerPriceId: 'price_fake',
      productId: product.id,
      active: true,
    });
    const auditActions = (await storage.auditLogs.list({ tenantId: 'tenant-a' }))
      .map((entry) => entry.action)
      .sort();
    expect(auditActions).toEqual(['price.activated', 'price.archived', 'price.created']);
    const eventTypes = (await storage.outboxEvents.claimPending(10))
      .map((event) => event.eventType)
      .sort();
    expect(eventTypes).toEqual(['price.activated.v1', 'price.archived.v1', 'price.created.v1']);
  });

  it('keeps identical remote product state as a local no-op', async () => {
    const { storage, clock } = context.harness();
    const provider = new CountingCatalogProvider();
    const products = createPayable({
      providers: { registered: provider },
      storage,
      clock,
    }).products('registered', 'tenant-a');

    await products.create({ name: 'Pro' });
    await products.create({ name: 'Pro' });

    expect(provider.productCreateCalls).toBe(2);
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toHaveLength(1);
    expect(await storage.outboxEvents.claimPending(10)).toHaveLength(1);
  });

  it('isolates equal provider product and price identities by tenant', async () => {
    const { storage, clock } = context.harness();
    const productA = await createLocalProduct(context, 'tenant-a');
    const productB = await createLocalProduct(context, 'tenant-b');
    const payable = createPayable({
      providers: { registered: new FakeProvider() },
      storage,
      clock,
    });

    await payable
      .prices('registered', 'tenant-a')
      .create({ providerProductId: 'prod_shared', unitAmount: Money.of(9900, 'USD') });
    await payable
      .prices('registered', 'tenant-b')
      .create({ providerProductId: 'prod_shared', unitAmount: Money.of(9900, 'USD') });

    const priceA = await storage.prices.findByProviderId('registered', 'price_fake', 'tenant-a');
    const priceB = await storage.prices.findByProviderId('registered', 'price_fake', 'tenant-b');
    expect(priceA).toMatchObject({ tenantId: 'tenant-a', productId: productA.id });
    expect(priceB).toMatchObject({ tenantId: 'tenant-b', productId: productB.id });
    expect(priceA?.id).not.toBe(priceB?.id);
  });

  it('rolls back catalog state with audit and outbox failures', async () => {
    const { storage, clock } = context.harness();
    const persistenceCause = new Error('outbox unavailable');
    const products = createPayable({
      providers: { registered: new FakeProvider() },
      storage: withOutboxFailure(storage, persistenceCause),
      clock,
    }).products('registered', 'tenant-a');

    await expect(products.create({ name: 'Pro' })).rejects.toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      cause: persistenceCause,
    });
    await expect(
      storage.products.findByProviderId('registered', 'prod_fake', 'tenant-a'),
    ).resolves.toBeNull();
    expect(await storage.auditLogs.list({ tenantId: 'tenant-a' })).toEqual([]);
    expect(await storage.outboxEvents.claimPending(10)).toEqual([]);
  });
}

async function createLocalProduct(context: ContractContext, tenantId: string) {
  return context.harness().storage.products.create({
    tenantId,
    provider: 'registered',
    providerProductId: 'prod_shared',
    name: 'Pro',
    description: null,
    active: true,
    metadata: null,
  });
}
