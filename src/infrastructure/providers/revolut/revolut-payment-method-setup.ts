import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupDTO,
  PaymentMethodSetupStatus,
  PaymentMethodSetupUsage,
} from '../../../domain/dtos/payment-method-setup.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { RevolutOrder, RevolutOrderCreationPayload, RevolutRequest } from './revolut-types';

const STATUS: Record<string, PaymentMethodSetupStatus> = {
  pending: 'requires_action',
  processing: 'processing',
  authorised: 'processing',
  completed: 'succeeded',
  cancelled: 'canceled',
  failed: 'failed',
};

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toPaymentMethodSetupDTO(
  order: RevolutOrder,
  usage: PaymentMethodSetupUsage = 'off_session',
  providerCustomerId = order.customer?.id ?? '',
): PaymentMethodSetupDTO {
  return {
    providerSetupId: order.id,
    providerCustomerId,
    status: STATUS[order.state ?? ''] ?? 'unknown',
    usage,
    clientSecret: order.token ?? null,
    checkoutUrl: order.checkout_url ?? null,
    providerPaymentMethodId: order.payment_method?.id ?? null,
    createdAt: parseDate(order.created_at),
  };
}

export class RevolutPaymentMethodSetup {
  constructor(private readonly request: RevolutRequest) {}

  async create(
    input: CreatePaymentMethodSetupInput,
    ctx: OperationContext,
  ): Promise<PaymentMethodSetupDTO> {
    if (input.usage !== 'off_session') {
      throw new PayableError('Revolut supports off-session payment method setup only', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: 'revolut', operation: 'paymentMethodSetup', usage: input.usage },
      });
    }
    if (!input.currency) {
      throw new PayableError('Revolut payment method setup requires currency', {
        code: 'PAYMENT_METHOD_SETUP_CURRENCY_REQUIRED',
        context: { provider: 'revolut' },
      });
    }
    const body: RevolutOrderCreationPayload = {
      amount: 0,
      currency: input.currency,
      customer: { id: input.providerCustomerId },
      merchant_order_data: input.reference ? { reference: input.reference } : undefined,
      redirect_url: input.returnUrl,
    };
    const order = await this.request<RevolutOrder>('/api/orders', {
      method: 'POST',
      body,
      idempotencyKey: ctx.idempotencyKey,
    });
    return toPaymentMethodSetupDTO(order, input.usage, input.providerCustomerId);
  }

  async retrieve(providerSetupId: string): Promise<PaymentMethodSetupDTO> {
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(providerSetupId)}`,
      { method: 'GET' },
    );
    return toPaymentMethodSetupDTO(order);
  }

  async cancel(providerSetupId: string, ctx: OperationContext): Promise<PaymentMethodSetupDTO> {
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(providerSetupId)}/cancel`,
      { method: 'POST', idempotencyKey: ctx.idempotencyKey },
    );
    return toPaymentMethodSetupDTO(order);
  }
}
