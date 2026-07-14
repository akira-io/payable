import type { Clock } from '../../domain/contracts/clock.contract';
import type { EventBus } from '../../domain/contracts/event-bus.contract';
import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { TenantResolver } from '../../domain/contracts/tenant-resolver.contract';
import type { TreasuryProvider } from '../../domain/contracts/treasury-provider.contract';

export interface TreasuryWebhookDependencies {
  provider: TreasuryProvider;
  providerName: string;
  storage: StorageDriver;
  queue: QueueDriver;
  events: EventBus;
  clock: Clock;
  tenantResolver?: TenantResolver;
  tenantEnabled?: boolean;
}
