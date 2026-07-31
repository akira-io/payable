import { expect, it } from 'vitest';
import type { ContractContext } from './harness';

interface RuntimeCatalogRepository {
  create(data: Record<string, unknown>): Promise<unknown>;
  createMany(data: Record<string, unknown>[]): Promise<void>;
}

export function registerCatalogCreateContract(ctx: ContractContext): void {
  it('rejects a product create without a tenant before persisting it', async () => {
    const { storage } = ctx.harness();
    const products = storage.products as unknown as RuntimeCatalogRepository;

    await expect(
      products.create({
        provider: 'stripe',
        providerProductId: 'prod_omitted_tenant',
        name: 'Invalid product',
        description: null,
        active: true,
        metadata: null,
      }),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.products.findByProviderId('stripe', 'prod_omitted_tenant', null),
    ).resolves.toBeNull();
  });

  it('rejects a price create without a tenant before persisting it', async () => {
    const { storage } = ctx.harness();
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_price_parent',
      name: 'Price parent',
      description: null,
      active: true,
      metadata: null,
    });
    const prices = storage.prices as unknown as RuntimeCatalogRepository;

    await expect(
      prices.create({
        provider: 'stripe',
        providerPriceId: 'price_omitted_tenant',
        productId: product.id,
        currency: 'usd',
        unitAmount: 1999,
        interval: 'month',
        intervalCount: 1,
        active: true,
      }),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.prices.findByProviderId('stripe', 'price_omitted_tenant', null),
    ).resolves.toBeNull();
  });

  it('rejects a product batch with an omitted tenant before persisting any item', async () => {
    const { storage } = ctx.harness();
    const products = storage.products as unknown as RuntimeCatalogRepository;

    await expect(
      products.createMany([
        {
          tenantId: 'tenant-a',
          provider: 'stripe',
          providerProductId: 'prod_batch_valid',
          name: 'Valid product',
          active: true,
        },
        {
          provider: 'stripe',
          providerProductId: 'prod_batch_invalid',
          name: 'Invalid product',
          active: true,
        },
      ]),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.products.findByProviderId('stripe', 'prod_batch_valid', 'tenant-a'),
    ).resolves.toBeNull();
    await expect(
      storage.products.findByProviderId('stripe', 'prod_batch_invalid', null),
    ).resolves.toBeNull();
  });

  it('rejects a price batch with an omitted tenant before persisting any item', async () => {
    const { storage } = ctx.harness();
    const product = await storage.products.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerProductId: 'prod_batch_price_parent',
      name: 'Batch price parent',
      description: null,
      active: true,
      metadata: null,
    });
    const prices = storage.prices as unknown as RuntimeCatalogRepository;

    await expect(
      prices.createMany([
        {
          tenantId: 'tenant-a',
          provider: 'stripe',
          providerPriceId: 'price_batch_valid',
          productId: product.id,
          currency: 'usd',
          unitAmount: 1999,
          active: true,
        },
        {
          provider: 'stripe',
          providerPriceId: 'price_batch_invalid',
          productId: product.id,
          currency: 'usd',
          unitAmount: 2999,
          active: true,
        },
      ]),
    ).rejects.toThrow(/tenantId/i);
    await expect(
      storage.prices.findByProviderId('stripe', 'price_batch_valid', 'tenant-a'),
    ).resolves.toBeNull();
    await expect(
      storage.prices.findByProviderId('stripe', 'price_batch_invalid', null),
    ).resolves.toBeNull();
  });
}
