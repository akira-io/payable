import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { BillingDependencies } from './billing-dependencies';

export interface CatalogSyncDependencies extends BillingDependencies {
  queue: QueueDriver;
}
