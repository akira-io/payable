import type { Clock } from '../../domain/contracts/clock.contract';
import type { EventBus } from '../../domain/contracts/event-bus.contract';
import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { Repositories, StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { TenantResolver } from '../../domain/contracts/tenant-resolver.contract';
import type { VerifiedWebhook } from '../../domain/dtos/webhook.dto';

export interface WebhookDependencies {
  provider: PaymentProvider;
  providerName: string;
  storage: StorageDriver;
  queue: QueueDriver;
  events: EventBus;
  clock: Clock;
  tenantResolver?: TenantResolver;
  tenantEnabled?: boolean;
}

export interface WebhookReconciliation {
  deps: WebhookDependencies;
  repos: Repositories;
  verified: VerifiedWebhook;
  occurredAt: Date;
  tenantId: string | null;
}
