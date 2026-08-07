import type { Metadata, TenantScoped, Timestamps } from './common';

export interface CanonicalProduct extends TenantScoped, Timestamps {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly active: boolean;
  readonly metadata: Metadata | null;
}
