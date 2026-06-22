import type { Metadata, TenantScoped, Timestamps } from './common';

export interface Customer extends TenantScoped, Timestamps {
  readonly id: string;
  readonly provider: string;
  readonly providerCustomerId: string | null;
  readonly billableType: string;
  readonly billableId: string;
  readonly email: string;
  readonly name: string | null;
  readonly metadata: Metadata | null;
}
