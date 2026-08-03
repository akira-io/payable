export interface CatalogPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ListCatalogInput {
  limit?: number;
  cursor?: string;
  active?: boolean;
}

export interface ListProductsInput extends ListCatalogInput {}

export interface ListPricesInput extends ListCatalogInput {
  providerProductId?: string;
  lookupKeys?: string[];
}
