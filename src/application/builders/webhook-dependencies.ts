import type { Clock } from '../../domain/contracts/clock.contract';
import type { EventBus } from '../../domain/contracts/event-bus.contract';
import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';

export interface WebhookDependencies {
  provider: PaymentProvider;
  providerName: string;
  storage: StorageDriver;
  events: EventBus;
  clock: Clock;
}
