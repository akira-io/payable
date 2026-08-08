import type { Metadata } from '../entities/common';

export interface CreateProductInput {
  name: string;
  description?: string;
  active?: boolean;
  metadata?: Metadata;
}

export interface UpdateProductInput {
  providerProductId: string;
  name?: string;
  description?: string | null;
  metadata?: Metadata | null;
  active?: boolean;
}

export interface ProductDTO {
  providerProductId: string;
  name: string;
  description: string | null;
  active: boolean;
  metadata: Metadata | null;
  providerVersion?: string | null;
}
