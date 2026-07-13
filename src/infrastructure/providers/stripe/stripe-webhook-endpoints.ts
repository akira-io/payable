import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateProviderWebhookEndpointInput,
  ListProviderWebhookEndpointsInput,
  ProviderWebhookEndpointDTO,
  UpdateProviderWebhookEndpointInput,
} from '../../../domain/dtos/provider-webhook-endpoint.dto';
import { withStripeErrors } from './stripe-errors';
import { toStripeWebhookEndpointDTO } from './stripe-mappers';

const DEFAULT_ENDPOINT_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export class StripeWebhookEndpoints {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(
    input: CreateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    const stripe = await this.client();
    const endpoint = await withStripeErrors(() =>
      stripe.webhookEndpoints.create(
        {
          url: input.url,
          enabled_events: input.events as Stripe.WebhookEndpointCreateParams.EnabledEvent[],
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toStripeWebhookEndpointDTO(endpoint);
  }

  async list(input: ListProviderWebhookEndpointsInput = {}): Promise<ProviderWebhookEndpointDTO[]> {
    const stripe = await this.client();
    const limit = input.limit ?? DEFAULT_ENDPOINT_LIMIT;
    const endpoints = await withStripeErrors(() =>
      stripe.webhookEndpoints
        .list({ limit: Math.min(limit, STRIPE_PAGE_LIMIT) })
        .autoPagingToArray({ limit }),
    );
    return endpoints.map(toStripeWebhookEndpointDTO);
  }

  async retrieve(providerWebhookEndpointId: string): Promise<ProviderWebhookEndpointDTO> {
    const stripe = await this.client();
    const endpoint = await withStripeErrors(() =>
      stripe.webhookEndpoints.retrieve(providerWebhookEndpointId),
    );
    return toStripeWebhookEndpointDTO(endpoint);
  }

  async update(
    input: UpdateProviderWebhookEndpointInput,
    ctx: OperationContext,
  ): Promise<ProviderWebhookEndpointDTO> {
    const stripe = await this.client();
    const endpoint = await withStripeErrors(() =>
      stripe.webhookEndpoints.update(
        input.providerWebhookEndpointId,
        {
          url: input.url,
          enabled_events: input.events as
            | Stripe.WebhookEndpointUpdateParams.EnabledEvent[]
            | undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toStripeWebhookEndpointDTO(endpoint);
  }

  async delete(providerWebhookEndpointId: string, ctx: OperationContext): Promise<void> {
    const stripe = await this.client();
    await withStripeErrors(() =>
      stripe.webhookEndpoints.del(
        providerWebhookEndpointId,
        {},
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
  }
}
