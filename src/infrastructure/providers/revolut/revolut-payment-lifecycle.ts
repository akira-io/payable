import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  AuthorizationResultDTO,
  AuthorizePaymentInput,
  CapturePaymentInput,
  CaptureResultDTO,
  VoidPaymentInput,
  VoidResultDTO,
} from '../../../domain/dtos/payment-lifecycle.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { toRevolutCheckoutSessionDTO } from './revolut-mappers';
import type { RevolutOrder, RevolutOrderCreationPayload, RevolutRequest } from './revolut-types';

function paymentStatus(state?: string) {
  if (state === 'authorised' || state === 'authorized') return 'authorized' as const;
  if (state === 'completed') return 'succeeded' as const;
  if (state === 'cancelled' || state === 'canceled') return 'canceled' as const;
  if (state === 'failed') return 'failed' as const;
  return 'processing' as const;
}

export class RevolutPaymentLifecycle {
  constructor(private readonly request: RevolutRequest) {}

  async authorize(
    input: AuthorizePaymentInput,
    ctx: OperationContext,
  ): Promise<AuthorizationResultDTO> {
    const body: RevolutOrderCreationPayload = {
      amount: input.amount.amount(),
      currency: input.amount.currency(),
      capture_mode: 'manual',
      customer: input.providerCustomerId ? { id: input.providerCustomerId } : undefined,
      merchant_order_data: { reference: input.reference },
      redirect_url: input.successUrl,
    };
    const order = await this.request<RevolutOrder>('/api/orders', {
      method: 'POST',
      body,
      idempotencyKey: ctx.idempotencyKey,
    });
    return {
      providerPaymentId: order.id,
      status: paymentStatus(order.state),
      amount: input.amount,
      ...(order.capture_deadline ? { expiresAt: new Date(order.capture_deadline) } : {}),
      ...(order.checkout_url ? { checkout: toRevolutCheckoutSessionDTO(order) } : {}),
    };
  }

  async capture(input: CapturePaymentInput, ctx: OperationContext): Promise<CaptureResultDTO> {
    if (!input.amount) {
      throw new PayableError('Revolut capture requires an explicit amount', {
        code: 'CAPTURE_AMOUNT_REQUIRED',
      });
    }
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(input.providerPaymentId)}/capture`,
      {
        method: 'POST',
        body: { amount: input.amount.amount() },
        idempotencyKey: ctx.idempotencyKey,
      },
    );
    return {
      providerPaymentId: order.id,
      status: paymentStatus(order.state),
      amount: input.amount,
    };
  }

  async void(input: VoidPaymentInput, ctx: OperationContext): Promise<VoidResultDTO> {
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(input.providerPaymentId)}/cancel`,
      { method: 'POST', idempotencyKey: ctx.idempotencyKey },
    );
    return { providerPaymentId: order.id, status: paymentStatus(order.state) };
  }
}
