import type { StorageDriver } from '../../src/domain/contracts/storage-driver.contract';

export async function seedAuthorizedCatalogProduct(
  storage: StorageDriver,
  allowed: boolean,
): Promise<void> {
  if (!allowed) {
    return;
  }
  await storage.products.create({
    tenantId: 'tenant-a',
    provider: 'stripe',
    providerProductId: 'prod_fake',
    name: 'Product',
    description: null,
    active: true,
    metadata: null,
  });
}
