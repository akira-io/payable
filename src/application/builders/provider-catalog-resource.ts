import type { BillingDependencies } from './billing-dependencies';
import { PriceResource } from './price-resource';
import { ProductResource } from './product-resource';

export class ProviderCatalogResource {
  readonly products: ProductResource;
  readonly prices: PriceResource;

  constructor(dependencies: BillingDependencies) {
    this.products = new ProductResource(dependencies);
    this.prices = new PriceResource(dependencies);
  }
}
