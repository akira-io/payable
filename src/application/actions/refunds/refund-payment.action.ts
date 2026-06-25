import type { Refund } from '../../../domain/entities/refund.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Money } from '../../../domain/value-objects/money';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanRefundPaymentPolicy } from '../../policies/can-refund-payment.policy';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export interface RefundPaymentActionInput {
  paymentId: string;
  amount?: Money;
  reason?: string;
  authorization?: AuthorizationContext;
}

export class RefundPaymentAction {
  constructor(
    private readonly deps: BillingDependencies,
    private readonly policy = new CanRefundPaymentPolicy(),
  ) {}

  async handle(input: RefundPaymentActionInput): Promise<Refund> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => this.policy.authorize(context),
      input.authorization,
      'refund payment',
    );
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Refunding requires a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    const payment = await storage.payments.findById(input.paymentId, this.deps.tenantId);
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
    if (input.amount && input.amount.currency() !== payment.currency) {
      throw new PayableError(
        `Refund currency ${input.amount.currency()} does not match payment currency ${payment.currency}`,
        { code: 'REFUND_CURRENCY_MISMATCH', context: { paymentId: payment.id } },
      );
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
      tenantId: this.deps.tenantId ?? null,
      provider: this.deps.providerName,
      paymentId: payment.providerPaymentId,
      amount: requested,
      currency: payment.currency,
    });
    const correlationId = CorrelationId.generate().toString();
    const refundable = {
      id: payment.id,
      providerPaymentId: payment.providerPaymentId,
      currency: payment.currency,
      amount: payment.amount,
    };
    const run = (): Promise<Refund> => this.settle(storage, refundable, input, key, correlationId);
    if (!this.deps.idempotency) {
      return run();
    }
    return this.deps.idempotency.execute({
      key: key.toString(),
      scope: 'refund',
      operation: 'refund',
      request: { paymentId: payment.id, amount: requested, currency: payment.currency },
      resourceType: 'refund',
      tenantId: this.deps.tenantId,
      retryFailed: false,
      run,
      revive: async (response) => {
        const fresh = await storage.refunds.findById(
          (response as { id: string }).id,
          this.deps.tenantId ?? null,
        );
        return fresh ?? (response as Refund);
      },
    });
  }

  private async settle(
    storage: NonNullable<BillingDependencies['storage']>,
    payment: { id: string; providerPaymentId: string; currency: string; amount: number },
    input: RefundPaymentActionInput,
    key: IdempotencyKey,
    correlationId: string,
  ): Promise<Refund> {
    const dto = await this.deps.provider.refund(
      { providerPaymentId: payment.providerPaymentId, amount: input.amount, reason: input.reason },
      { correlationId, idempotencyKey: key.toString() },
    );
    if (dto.amount.currency() !== payment.currency) {
      throw new PayableError(
        `Refund currency ${dto.amount.currency()} does not match payment currency ${payment.currency}`,
        { code: 'REFUND_CURRENCY_MISMATCH', context: { paymentId: payment.id } },
      );
    }
    return storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(payment.id, this.deps.tenantId);
      if (!fresh) {
        throw new PayableError(`Payment not found: ${input.paymentId}`, {
          code: 'PAYMENT_NOT_FOUND',
        });
      }
      const freshRemaining = fresh.amount - fresh.refundedAmount;
      if (freshRemaining <= 0 || dto.amount.amount() > freshRemaining) {
        throw new PayableError(
          `Refund of ${dto.amount.amount()} exceeds remaining ${freshRemaining}`,
          {
            code: 'REFUND_EXCEEDS_REMAINING',
            context: {
              paymentId: fresh.id,
              requested: dto.amount.amount(),
              remaining: freshRemaining,
            },
          },
        );
      }
      const refund = await repos.refunds.create({
        tenantId: this.deps.tenantId ?? null,
        paymentId: fresh.id,
        provider: this.deps.providerName,
        providerRefundId: dto.providerRefundId,
        status: dto.status,
        currency: dto.amount.currency(),
        amount: dto.amount.amount(),
        reason: input.reason ?? null,
      });
      const refundedAmount = fresh.refundedAmount + dto.amount.amount();
      const machine = new PaymentStateMachine(fresh.status);
      const updated = refundedAmount >= fresh.amount ? machine.refund() : machine.partiallyRefund();
      await repos.payments.update(
        fresh.id,
        { refundedAmount, status: updated.current() },
        this.deps.tenantId,
      );
      await repos.auditLogs.create({
        tenantId: this.deps.tenantId ?? null,
        correlationId,
        actorType: input.authorization?.actorType ?? null,
        actorId: input.authorization?.actorId ?? null,
        action: 'payment.refunded',
        resourceType: 'payment',
        resourceId: fresh.id,
        before: { refundedAmount: fresh.refundedAmount, status: fresh.status },
        after: { refundedAmount, status: updated.current() },
        metadata: { refundId: refund.id, amount: dto.amount.amount() },
        ipAddress: null,
        userAgent: null,
      });
      return refund;
    });
  }
}
