import type { Clock } from '../../domain/contracts/clock.contract';
import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';

export interface BillingDependencies {
  provider: PaymentProvider;
  providerName: string;
  clock: Clock;
  storage?: StorageDriver;
  tenantId?: string | null;
  authorizationEnabled?: boolean;
}
