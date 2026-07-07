import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import type { RefundStatus } from '../../../domain/value-objects/refund-status';
import type { RevolutOrder } from './revolut-types';

const REFUND_STATUS_BY_STATE: Record<string, RefundStatus> = {
  pending: 'pending',
  processing: 'pending',
  authorised: 'pending',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'failed',
};

export function toRevolutCheckoutSessionDTO(order: RevolutOrder): CheckoutSessionDTO {
  if (!order.checkout_url) {
    throw new PayableError('Revolut order did not return a checkout URL', {
      code: 'PROVIDER_REVOLUT_CHECKOUT_URL_MISSING',
      context: { provider: 'revolut', orderId: order.id },
    });
  }
  return { id: order.id, url: order.checkout_url };
}

export function toRevolutRefundResultDTO(
  order: RevolutOrder,
  amount: RefundResultDTO['amount'],
): RefundResultDTO {
  return {
    providerRefundId: order.id,
    status: refundStatus(order.state),
    amount,
  };
}

function refundStatus(state?: string): RefundStatus {
  if (!state) {
    return 'pending';
  }
  return REFUND_STATUS_BY_STATE[state] ?? 'pending';
}
