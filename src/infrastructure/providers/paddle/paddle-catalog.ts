import type {
  CatalogPage,
  ListPricesInput,
  ListProductsInput,
} from '../../../domain/dtos/catalog.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO, UpdatePriceInput } from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import { createPriceNotFoundFactory, createProductNotFoundFactory } from '../catalog-not-found';
import { paddleAmount } from './paddle-amounts';
import { withPaddleErrors } from './paddle-errors';
import { toPriceDTO, toProductDTO } from './paddle-mappers';
import type { PaddleClient } from './paddle-types';

export class PaddleCatalog {
  constructor(private readonly client: () => Promise<PaddleClient>) {}

  async createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(() =>
      paddle.products.create({
        name: input.name,
        taxCategory: 'standard',
        description: input.description,
        customData: input.metadata,
      }),
    );
    if (input.active !== false) {
      return toProductDTO(product);
    }
    const archivedProduct = await withPaddleErrors(
      () => paddle.products.update(product.id, { status: 'archived' }),
      createProductNotFoundFactory(product.id, ctx),
    );
    return toProductDTO(archivedProduct);
  }

  async updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(
      () =>
        paddle.products.update(input.providerProductId, {
          name: input.name,
          description: input.description,
          status: input.active === undefined ? undefined : input.active ? 'active' : 'archived',
        }),
      createProductNotFoundFactory(input.providerProductId, ctx),
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

  async updatePrice(input: UpdatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    const paddle = await this.client();
    const price = await withPaddleErrors(
      () => paddle.prices.update(input.providerPriceId, { description: input.description ?? '' }),
      createPriceNotFoundFactory(input.providerPriceId, ctx),
    );
    return toPriceDTO(price);
  }

  async retrieveProduct(id: string): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(
      () => paddle.products.get(id),
      createProductNotFoundFactory(id),
    );
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
    const price = await withPaddleErrors(
      () => paddle.prices.get(id),
      createPriceNotFoundFactory(id),
    );
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

  async setProductActive(id: string, active: boolean, ctx: OperationContext): Promise<ProductDTO> {
    const paddle = await this.client();
    const product = await withPaddleErrors(
      () => paddle.products.update(id, { status: active ? 'active' : 'archived' }),
      createProductNotFoundFactory(id, ctx),
    );
    return toProductDTO(product);
  }

  async setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO> {
    const paddle = await this.client();
    const price = await withPaddleErrors(
      () => paddle.prices.update(id, { status: active ? 'active' : 'archived' }),
      createPriceNotFoundFactory(id, ctx),
    );
    return toPriceDTO(price);
  }
}
