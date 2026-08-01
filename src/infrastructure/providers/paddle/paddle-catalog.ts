import type {
  CatalogPage,
  ListPricesInput,
  ListProductsInput,
} from '../../../domain/dtos/catalog.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import { paddleAmount } from './paddle-amounts';
import { withPaddleErrors } from './paddle-errors';
import { toPriceDTO, toProductDTO } from './paddle-mappers';
import type { PaddleClient } from './paddle-types';

export class PaddleCatalog {
  constructor(private readonly client: () => Promise<PaddleClient>) {}

  async createProduct(input: CreateProductInput, _ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(() =>
      paddle.products.create({
        name: input.name,
        taxCategory: 'standard',
        description: input.description,
        customData: input.metadata,
        status: input.active === undefined ? undefined : input.active ? 'active' : 'archived',
      }),
    );
    return toProductDTO(product);
  }

  async updateProduct(input: UpdateProductInput, _ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(
      () =>
        paddle.products.update(input.providerProductId, {
          name: input.name,
          description: input.description,
          status: input.active === undefined ? undefined : input.active ? 'active' : 'archived',
        }),
      'PRODUCT_NOT_FOUND',
    );
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput, _ctx: OperationContext): Promise<PriceDTO> {
    const paddle = await this.client();
    const price = await withPaddleErrors(() =>
      paddle.prices.create({
        productId: input.providerProductId,
        description:
          input.description ?? (input.interval ? `${input.interval} price` : 'One-time price'),
        unitPrice: {
          amount: paddleAmount(input.unitAmount),
          currencyCode: input.unitAmount.currency(),
        },
        billingCycle: input.interval
          ? { interval: input.interval, frequency: input.intervalCount ?? 1 }
          : undefined,
      }),
    );
    return toPriceDTO(price);
  }

  async retrieveProduct(id: string): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(() => paddle.products.get(id), 'PRODUCT_NOT_FOUND');
    return toProductDTO(product);
  }

  async listProducts(input: ListProductsInput = {}): Promise<CatalogPage<ProductDTO>> {
    const paddle = await this.client();
    const collection = await withPaddleErrors(async () =>
      paddle.products.list({
        after: input.cursor,
        perPage: input.limit,
        status: input.active === undefined ? undefined : [input.active ? 'active' : 'archived'],
      }),
    );
    const products = await withPaddleErrors(() => collection.next());
    return {
      data: products.map(toProductDTO),
      nextCursor: collection.hasMore ? (products.at(-1)?.id ?? null) : null,
    };
  }

  async retrievePrice(id: string): Promise<PriceDTO> {
    const paddle = await this.client();
    const price = await withPaddleErrors(() => paddle.prices.get(id), 'PRICE_NOT_FOUND');
    return toPriceDTO(price);
  }

  async listPrices(input: ListPricesInput = {}): Promise<CatalogPage<PriceDTO>> {
    const paddle = await this.client();
    const collection = await withPaddleErrors(async () =>
      paddle.prices.list({
        after: input.cursor,
        perPage: input.limit,
        productId: input.providerProductId ? [input.providerProductId] : undefined,
        status: input.active === undefined ? undefined : [input.active ? 'active' : 'archived'],
      }),
    );
    const prices = await withPaddleErrors(() => collection.next());
    return {
      data: prices.map(toPriceDTO),
      nextCursor: collection.hasMore ? (prices.at(-1)?.id ?? null) : null,
    };
  }

  async setProductActive(id: string, active: boolean, _ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(
      () => paddle.products.update(id, { status: active ? 'active' : 'archived' }),
      'PRODUCT_NOT_FOUND',
    );
    return toProductDTO(product);
  }

  async setPriceActive(id: string, active: boolean, _ctx: OperationContext): Promise<PriceDTO> {
    const paddle = await this.client();
    const price = await withPaddleErrors(
      () => paddle.prices.update(id, { status: active ? 'active' : 'archived' }),
      'PRICE_NOT_FOUND',
    );
    return toPriceDTO(price);
  }
}
