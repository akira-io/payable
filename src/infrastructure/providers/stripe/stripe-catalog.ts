import type Stripe from 'stripe';
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
    };
    if (input.interval) {
      params.recurring = { interval: input.interval, interval_count: input.intervalCount ?? 1 };
    }
    const price = await withStripeErrors(() =>
      stripe.prices.create(params, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toPriceDTO(price);
  }
}
