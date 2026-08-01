import type Stripe from 'stripe';
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
import { stripeAmount } from './stripe-amounts';
import { withStripeErrors } from './stripe-errors';
import { toPriceDTO, toProductDTO } from './stripe-mappers';

export class StripeCatalog {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async createProduct(input: CreateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const stripe = await this.client();
    const product = await withStripeErrors(() =>
      stripe.products.create(
        {
          name: input.name,
          description: input.description,
          active: input.active,
          metadata: input.metadata,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toProductDTO(product);
  }

  async updateProduct(input: UpdateProductInput, ctx: OperationContext): Promise<ProductDTO> {
    const stripe = await this.client();
    const product = await withStripeErrors(() =>
      stripe.products.update(
        input.providerProductId,
        { name: input.name, description: input.description, active: input.active },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    const stripe = await this.client();
    const params: Stripe.PriceCreateParams = {
      product: input.providerProductId,
      currency: input.unitAmount.currency().toLowerCase(),
      unit_amount: stripeAmount(input.unitAmount),
      nickname: input.description,
    };
    if (input.interval) {
      params.recurring = { interval: input.interval, interval_count: input.intervalCount ?? 1 };
    }
    const price = await withStripeErrors(() =>
      stripe.prices.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toPriceDTO(price);
  }

  async retrieveProduct(id: string): Promise<ProductDTO> {
    const stripe = await this.client();
    const product = await withStripeErrors(
      () => stripe.products.retrieve(id),
      'stripe',
      'PRODUCT_NOT_FOUND',
    );
    return toProductDTO(product);
  }

  async listProducts(input: ListProductsInput = {}): Promise<CatalogPage<ProductDTO>> {
    const stripe = await this.client();
    const page = await withStripeErrors(() =>
      stripe.products.list({
        active: input.active,
        limit: input.limit,
        starting_after: input.cursor,
      }),
    );
    return {
      data: page.data.map(toProductDTO),
      nextCursor: page.has_more ? (page.data.at(-1)?.id ?? null) : null,
    };
  }

  async retrievePrice(id: string): Promise<PriceDTO> {
    const stripe = await this.client();
    const price = await withStripeErrors(
      () => stripe.prices.retrieve(id),
      'stripe',
      'PRICE_NOT_FOUND',
    );
    return toPriceDTO(price);
  }

  async listPrices(input: ListPricesInput = {}): Promise<CatalogPage<PriceDTO>> {
    const stripe = await this.client();
    const page = await withStripeErrors(() =>
      stripe.prices.list({
        active: input.active,
        limit: input.limit,
        product: input.providerProductId,
        starting_after: input.cursor,
      }),
    );
    return {
      data: page.data.map(toPriceDTO),
      nextCursor: page.has_more ? (page.data.at(-1)?.id ?? null) : null,
    };
  }

  async setProductActive(id: string, active: boolean, ctx: OperationContext): Promise<ProductDTO> {
    const stripe = await this.client();
    const product = await withStripeErrors(
      () => stripe.products.update(id, { active }, { idempotencyKey: ctx.idempotencyKey }),
      'stripe',
      'PRODUCT_NOT_FOUND',
    );
    return toProductDTO(product);
  }

  async setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO> {
    const stripe = await this.client();
    const price = await withStripeErrors(
      () => stripe.prices.update(id, { active }, { idempotencyKey: ctx.idempotencyKey }),
      'stripe',
      'PRICE_NOT_FOUND',
    );
    return toPriceDTO(price);
  }
}
