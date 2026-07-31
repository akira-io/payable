import type { Timestamps } from './common';

export interface CustomerProviderBinding extends Timestamps {
  readonly id: string;
  readonly customerId: string;
  readonly provider: string;
  readonly providerCustomerId: string;
}
