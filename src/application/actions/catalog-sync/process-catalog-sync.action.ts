import type { CatalogSyncDependencies } from '../../builders/catalog-sync-dependencies';
import { CatalogPriceSynchronizer } from './catalog-price-synchronizer';
import { CatalogProductSynchronizer } from './catalog-product-synchronizer';
import type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';

export type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';
export { PROCESS_CATALOG_SYNC_JOB } from './catalog-sync-job';

export class ProcessCatalogSyncAction {
  constructor(private readonly dependencies: CatalogSyncDependencies) {}

  async handle(payload: ProcessCatalogSyncJobPayload): Promise<void> {
    if (payload.resourceType === 'product') {
      await new CatalogProductSynchronizer(this.dependencies).handle(payload);
      return;
    }
    await new CatalogPriceSynchronizer(this.dependencies).handle(payload);
  }
}
