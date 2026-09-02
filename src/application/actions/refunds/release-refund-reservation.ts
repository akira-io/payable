import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { BillingDependencies } from '../../builders/billing-dependencies';

const MAX_RELEASE_ATTEMPTS = 3;

interface RefundReservation {
  refundId: string;
  requested: number;
}

interface ProviderResult {
  providerRefundId: string;
  status: 'failed' | 'canceled';
}

export async function releaseRefundReservation(
  storage: NonNullable<BillingDependencies['storage']>,
  tenantId: string | null | undefined,
  paymentId: string,
  reservation: RefundReservation,
  providerResult?: ProviderResult,
): Promise<void> {
  const refundPatch = {
    status: providerResult?.status ?? ('failed' as const),
    providerRefundId: providerResult?.providerRefundId,
  };
  for (let attempt = 0; attempt < MAX_RELEASE_ATTEMPTS; attempt += 1) {
    const released = await storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(paymentId, tenantId);
      if (!fresh) {
        await repos.refunds.update(reservation.refundId, refundPatch);
        return true;
      }
      const refundedAmount = Math.max(0, fresh.refundedAmount - reservation.requested);
      const status: PaymentStatus = refundedAmount <= 0 ? 'succeeded' : 'partially_refunded';
      const reverted = await repos.payments.updateRefundedAmountIfUnchanged(
        fresh.id,
        fresh.refundedAmount,
        { refundedAmount, status },
        tenantId,
      );
      if (reverted) await repos.refunds.update(reservation.refundId, refundPatch);
      return reverted;
    });
    if (released) return;
  }
  await storage.refunds.update(reservation.refundId, refundPatch);
}
