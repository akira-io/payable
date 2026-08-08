import type { QueueDriver, QueueJob } from '../../../domain/contracts/queue-driver.contract';
import type { DependencyFactory } from '../../builders/dependency-factory';
import type { ProcessCatalogSyncJobPayload } from './catalog-sync-job';
import { PROCESS_CATALOG_SYNC_JOB, ProcessCatalogSyncAction } from './process-catalog-sync.action';

export function registerCatalogSyncProcessor(queue: QueueDriver, factory: DependencyFactory): void {
  queue.process(PROCESS_CATALOG_SYNC_JOB, async (job: QueueJob) => {
    const payload = job.payload as ProcessCatalogSyncJobPayload;
    await new ProcessCatalogSyncAction({
      ...factory.billing(payload.providerName, payload.tenantId),
      queue,
    }).handle(payload);
  });
}
