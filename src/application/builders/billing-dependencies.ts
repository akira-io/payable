import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { LocalDependencies } from './local-dependencies';

export interface BillingDependencies extends LocalDependencies {
  provider: PaymentProvider;
  providerName: string;
}
