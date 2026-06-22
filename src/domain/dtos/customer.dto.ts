import type { Metadata } from '../entities/common';

export interface CreateCustomerInput {
  email: string;
  name?: string;
  billableType: string;
  billableId: string;
  metadata?: Metadata;
}

export interface UpdateCustomerInput {
  providerCustomerId: string;
  email?: string;
  name?: string;
  metadata?: Metadata;
}

export interface CustomerDTO {
  providerCustomerId: string;
  email: string;
  name: string | null;
}
