import type { Metadata, TenantScoped, Timestamps } from './common';

export interface Product extends TenantScoped, Timestamps {
  readonly id: string;
  readonly provider: string;
  readonly providerProductId: string | null;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly metadata: Metadata | null;
}
