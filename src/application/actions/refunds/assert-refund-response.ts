import type { RefundRepository } from '../../../domain/contracts/refund-repository.contract';
import type { RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { PayableError } from '../../../domain/errors/payable-error';

interface ReservedRefund {
  paymentId: string;
  refundId: string;
  amount: number;
  currency: string;
}

export async function assertRefundResponse(
  refunds: RefundRepository,
  reservation: ReservedRefund,
  response: RefundResultDTO,
): Promise<void> {
  if (
    response.amount.amount() === reservation.amount &&
    response.amount.currency() === reservation.currency
  ) {
    return;
  }
  await refunds.update(reservation.refundId, {
    providerRefundId: response.providerRefundId,
    status: 'pending',
  });
  throw new PayableError('Provider refund response does not match the reserved refund', {
    code: 'REFUND_PROVIDER_RESPONSE_MISMATCH',
    context: {
      paymentId: reservation.paymentId,
      refundId: reservation.refundId,
      providerRefundId: response.providerRefundId,
      requestedAmount: reservation.amount,
      actualAmount: response.amount.amount(),
      requestedCurrency: reservation.currency,
      actualCurrency: response.amount.currency(),
      reconciliationRequired: true,
    },
  });
}
