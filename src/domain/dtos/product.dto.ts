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
  description?: string;
  active?: boolean;
}

export interface ProductDTO {
  providerProductId: string;
  name: string;
  active: boolean;
}
