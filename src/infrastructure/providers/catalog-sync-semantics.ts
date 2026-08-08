import type { CatalogSyncSemantics } from '../../domain/contracts/catalog-provider.contract';

export const STRIPE_CATALOG_SYNC_SEMANTICS: CatalogSyncSemantics = {
  inactiveProductCreate: true,
  clearProductDescription: true,
  clearProductMetadata: true,
  clearPriceDescription: true,
};

export const PADDLE_CATALOG_SYNC_SEMANTICS: CatalogSyncSemantics = {
  inactiveProductCreate: false,
  clearProductDescription: false,
  clearProductMetadata: true,
  clearPriceDescription: false,
};
