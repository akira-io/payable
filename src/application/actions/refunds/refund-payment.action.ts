import type { Refund } from '../../../domain/entities/refund.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Money } from '../../../domain/value-objects/money';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export interface RefundPaymentActionInput {
  paymentId: string;
  amount?: Money;
  reason?: string;
}

export class RefundPaymentAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(input: RefundPaymentActionInput): Promise<Refund> {
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Refunding requires a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    const payment = await storage.payments.findById(input.paymentId);
    if (!payment?.providerPaymentId) {
      throw new PayableError(`Payment not found: ${input.paymentId}`, {
        code: 'PAYMENT_NOT_FOUND',
      });
    }
    if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
      throw new PayableError(`Payment ${payment.id} is not refundable`, {
        code: 'PAYMENT_NOT_REFUNDABLE',
        context: { paymentId: payment.id, status: payment.status },
      });
    }
    const remaining = payment.amount - payment.refundedAmount;
    const requested = input.amount?.amount() ?? remaining;
    if (remaining <= 0 || requested > remaining) {
      throw new PayableError(`Refund of ${requested} exceeds remaining ${remaining}`, {
        code: 'REFUND_EXCEEDS_REMAINING',
        context: { paymentId: payment.id, requested, remaining },
      });
    }
    assertProviderCapability(this.deps.provider, 'refunds');
    const key = IdempotencyKey.forRefund({
      provider: this.deps.providerName,
      paymentId: payment.providerPaymentId,
      amount: input.amount?.amount() ?? payment.amount,
      currency: payment.currency,
    });
    const dto = await this.deps.provider.refund(
      { providerPaymentId: payment.providerPaymentId, amount: input.amount, reason: input.reason },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
    );
    if (dto.amount.currency() !== payment.currency) {
      throw new PayableError(
        `Refund currency ${dto.amount.currency()} does not match payment currency ${payment.currency}`,
        { code: 'REFUND_CURRENCY_MISMATCH', context: { paymentId: payment.id } },
      );
    }
    const refund = await storage.refunds.create({
      tenantId: this.deps.tenantId ?? null,
      paymentId: payment.id,
      provider: this.deps.providerName,
      providerRefundId: dto.providerRefundId,
      status: dto.status,
      currency: dto.amount.currency(),
      amount: dto.amount.amount(),
      reason: input.reason ?? null,
    });
    const refundedAmount = payment.refundedAmount + dto.amount.amount();
    const machine = new PaymentStateMachine(payment.status);
    const updated = refundedAmount >= payment.amount ? machine.refund() : machine.partiallyRefund();
    await storage.payments.update(payment.id, { refundedAmount, status: updated.current() });
    return refund;
  }
}
