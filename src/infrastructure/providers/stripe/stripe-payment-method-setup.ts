import type Stripe from 'stripe';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupDTO,
  PaymentMethodSetupStatus,
} from '../../../domain/dtos/payment-method-setup.dto';
import { withStripeErrors } from './stripe-errors';

const STATUS: Record<string, PaymentMethodSetupStatus> = {
  requires_action: 'requires_action',
  requires_confirmation: 'requires_action',
  requires_payment_method: 'requires_action',
  processing: 'processing',
  succeeded: 'succeeded',
  canceled: 'canceled',
};

function resourceId(resource: { id: string } | string | null): string {
  if (!resource) {
    return '';
  }
  return typeof resource === 'string' ? resource : resource.id;
}

function toPaymentMethodSetupDTO(intent: Stripe.SetupIntent): PaymentMethodSetupDTO {
  return {
    providerSetupId: intent.id,
    providerCustomerId: resourceId(intent.customer),
    status: STATUS[intent.status] ?? 'unknown',
    usage: intent.usage === 'on_session' ? 'on_session' : 'off_session',
    clientSecret: intent.client_secret,
    checkoutUrl: null,
    providerPaymentMethodId: resourceId(intent.payment_method) || null,
    createdAt: new Date(intent.created * 1000),
  };
}

export class StripePaymentMethodSetup {
  constructor(private readonly client: () => Promise<Stripe>) {}

  async create(
    input: CreatePaymentMethodSetupInput,
    ctx: OperationContext,
  ): Promise<PaymentMethodSetupDTO> {
    const stripe = await this.client();
    const intent = await withStripeErrors(() =>
      stripe.setupIntents.create(
        {
          customer: input.providerCustomerId,
          usage: input.usage,
          payment_method_types: input.paymentMethodTypes,
          return_url: input.returnUrl,
          metadata: input.reference ? { reference: input.reference } : undefined,
        },
        { idempotencyKey: ctx.idempotencyKey },
      ),
    );
    return toPaymentMethodSetupDTO(intent);
  }

  async retrieve(providerSetupId: string): Promise<PaymentMethodSetupDTO> {
    const stripe = await this.client();
    const intent = await withStripeErrors(() => stripe.setupIntents.retrieve(providerSetupId));
    return toPaymentMethodSetupDTO(intent);
  }

  async cancel(providerSetupId: string, ctx: OperationContext): Promise<PaymentMethodSetupDTO> {
    const stripe = await this.client();
    const intent = await withStripeErrors(() =>
      stripe.setupIntents.cancel(providerSetupId, {}, { idempotencyKey: ctx.idempotencyKey }),
    );
    return toPaymentMethodSetupDTO(intent);
  }
}
