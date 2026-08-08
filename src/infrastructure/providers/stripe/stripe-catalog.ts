import type Stripe from 'stripe';
import type {
  CatalogPage,
  ListPricesInput,
  ListProductsInput,
} from '../../../domain/dtos/catalog.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreatePriceInput,
  PriceDTO,
  TransferPriceLookupKeyInput,
  UpdatePriceInput,
} from '../../../domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../../domain/dtos/product.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import {
  validateLookupKey,
  validateLookupKeys,
  validateTransferLookupKey,
} from '../../../domain/validation/price-lookup-key';
import { createPriceNotFoundFactory, createProductNotFoundFactory } from '../catalog-not-found';
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
    const product = await withStripeErrors(
      () =>
        stripe.products.update(
          input.providerProductId,
          { name: input.name, description: input.description, active: input.active },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      'stripe',
      createProductNotFoundFactory(input.providerProductId, ctx),
    );
    return toProductDTO(product);
  }

  async createPrice(input: CreatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    const lookupKey =
      input.lookupKey === undefined ? undefined : validateLookupKey(input.lookupKey);
    const transferLookupKey = validateTransferLookupKey(input.transferLookupKey, lookupKey);
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
    if (lookupKey !== undefined) {
      params.lookup_key = lookupKey;
    }
    if (transferLookupKey) {
      params.transfer_lookup_key = true;
    }
    const price = await withStripeErrors(() =>
      stripe.prices.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return lookupKey === undefined
      ? toPriceDTO(price)
      : requirePriceLookupKey(toPriceDTO(price), lookupKey);
  }

  async updatePrice(input: UpdatePriceInput, ctx: OperationContext): Promise<PriceDTO> {
    const stripe = await this.client();
    const price = await withStripeErrors(
      () =>
        stripe.prices.update(
          input.providerPriceId,
          { nickname: input.description ?? undefined },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      'stripe',
      createPriceNotFoundFactory(input.providerPriceId, ctx),
    );
    return toPriceDTO(price);
  }

  async retrieveProduct(id: string): Promise<ProductDTO> {
    const stripe = await this.client();
    const product = await withStripeErrors(
      () => stripe.products.retrieve(id),
      'stripe',
      createProductNotFoundFactory(id),
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
      createPriceNotFoundFactory(id),
    );
    return toPriceDTO(price);
  }

  async listPrices(input: ListPricesInput = {}): Promise<CatalogPage<PriceDTO>> {
    const lookupKeys =
      input.lookupKeys === undefined ? undefined : validateLookupKeys(input.lookupKeys);
    if (lookupKeys?.length === 0) {
      return { data: [], nextCursor: null };
    }
    const stripe = await this.client();
    const params: Stripe.PriceListParams = {
      active: input.active,
      limit: input.limit,
      product: input.providerProductId,
      starting_after: input.cursor,
    };
    if (lookupKeys !== undefined) {
      params.lookup_keys = lookupKeys;
    }
    const page = await withStripeErrors(() => stripe.prices.list(params));
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
      createProductNotFoundFactory(id, ctx),
    );
    return toProductDTO(product);
  }

  async setPriceActive(id: string, active: boolean, ctx: OperationContext): Promise<PriceDTO> {
    const stripe = await this.client();
    const price = await withStripeErrors(
      () => stripe.prices.update(id, { active }, { idempotencyKey: ctx.idempotencyKey }),
      'stripe',
      createPriceNotFoundFactory(id, ctx),
    );
    return toPriceDTO(price);
  }

  async transferPriceLookupKey(
    input: TransferPriceLookupKeyInput,
    ctx: OperationContext,
  ): Promise<PriceDTO> {
    validateLookupKey(input.providerPriceId, 'providerPriceId');
    const lookupKey = validateLookupKey(input.lookupKey);
    const stripe = await this.client();
    const price = await withStripeErrors(
      () =>
        stripe.prices.update(
          input.providerPriceId,
          { lookup_key: lookupKey, transfer_lookup_key: true },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      'stripe',
      createPriceNotFoundFactory(input.providerPriceId, ctx),
    );
    return requirePriceLookupKey(toPriceDTO(price), lookupKey);
  }
}

function requirePriceLookupKey(price: PriceDTO, lookupKey: string): PriceDTO {
  if (price.lookupKey === lookupKey) {
    return price;
  }
  throw new PayableError('Stripe price response does not contain the requested lookup key', {
    code: 'PROVIDER_RESPONSE_INVALID',
    context: { provider: 'stripe', field: 'lookup_key', providerPriceId: price.providerPriceId },
  });
}
