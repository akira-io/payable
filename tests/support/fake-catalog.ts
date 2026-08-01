import type {
  CatalogPage,
  ListPricesInput,
  ListProductsInput,
} from '../../src/domain/dtos/catalog.dto';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { PriceDTO } from '../../src/domain/dtos/price.dto';
import type { ProductDTO } from '../../src/domain/dtos/product.dto';
import { Money } from '../../src/domain/value-objects/money';

export class FakeCatalog {
  lastListProducts?: ListProductsInput;
  lastListPrices?: ListPricesInput;
  productActiveCalls: Array<{ id: string; active: boolean; ctx: OperationContext }> = [];
  priceActiveCalls: Array<{ id: string; active: boolean; ctx: OperationContext }> = [];
  productsPage: CatalogPage<ProductDTO> = {
    data: [
      {
        providerProductId: 'prod_fake',
        name: 'Product',
        description: null,
        active: true,
        metadata: null,
      },
    ],
    nextCursor: null,
  };
  pricesPage: CatalogPage<PriceDTO> = {
    data: [
      {
        providerPriceId: 'price_fake',
        providerProductId: 'prod_fake',
        unitAmount: Money.of(9900, 'USD'),
        interval: 'month',
        intervalCount: 1,
        description: null,
        active: true,
      },
    ],
    nextCursor: null,
  };

  async retrieveProduct(id: string): Promise<ProductDTO> {
    return (
      this.productsPage.data.find((product) => product.providerProductId === id) ?? {
        providerProductId: id,
        name: 'Product',
        description: null,
        active: true,
        metadata: null,
      }
    );
  }

  async listProducts(input?: ListProductsInput): Promise<CatalogPage<ProductDTO>> {
    this.lastListProducts = input;
    return this.productsPage;
  }

  async retrievePrice(id: string): Promise<PriceDTO> {
    return (
      this.pricesPage.data.find((price) => price.providerPriceId === id) ?? {
        providerPriceId: id,
        providerProductId: 'prod_fake',
        unitAmount: Money.of(9900, 'USD'),
        interval: 'month',
        intervalCount: 1,
        description: null,
        active: true,
      }
    );
  }

  async listPrices(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>> {
    this.lastListPrices = input;
    return this.pricesPage;
  }

  async setProductActive(id: string, active: boolean, ctx: OperationContext): Promise<ProductDTO> {
    this.productActiveCalls.push({ id, active, ctx });
    return {
      ...(await this.retrieveProduct(id)),
      active,
    };
  }

  async setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO> {
    this.priceActiveCalls.push({ id, active, ctx });
    return {
      ...(await this.retrievePrice(id)),
      active,
    };
  }
}
