import type { Refund } from '../../../domain/entities/refund.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { resolveInitialRefundStatus } from '../../../domain/states/refund-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Money } from '../../../domain/value-objects/money';
import type { PaymentStatus } from '../../../domain/value-objects/payment-status';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanRefundPaymentPolicy } from '../../policies/can-refund-payment.policy';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export interface RefundPaymentActionInput {
  paymentId: string;
  amount?: Money;
  reason?: string;
  reference?: string;
  authorization?: AuthorizationContext;
}

interface RefundReservation {
  refundId: string;
  requested: number;
  beforeRefunded: number;
  beforeStatus: PaymentStatus;
  afterRefunded: number;
  afterStatus: PaymentStatus;
}

const MAX_RESERVATION_ATTEMPTS = 3;

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
    if (input.amount && input.amount.amount() <= 0) {
      throw new PayableError(`Refund amount must be positive, got ${input.amount.amount()}`, {
        code: 'REFUND_AMOUNT_INVALID',
        context: { amount: input.amount.amount(), currency: input.amount.currency() },
      });
    }
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
      reference: input.reference,
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
    const reservation = await this.reserve(storage, payment, input);
    let dto: Awaited<ReturnType<typeof this.deps.provider.refund>>;
    try {
      dto = await this.deps.provider.refund(
        {
          providerPaymentId: payment.providerPaymentId,
          amount: input.amount,
          reason: input.reason,
          reference: input.reference,
        },
        { correlationId, idempotencyKey: key.toString() },
      );
    } catch (error) {
      await this.releaseReservation(storage, payment.id, reservation);
      throw error;
    }
    if (dto.amount.currency() !== payment.currency) {
      await this.releaseReservation(storage, payment.id, reservation);
      throw new PayableError(
        `Refund currency ${dto.amount.currency()} does not match payment currency ${payment.currency}`,
        { code: 'REFUND_CURRENCY_MISMATCH', context: { paymentId: payment.id } },
      );
    }
    return storage.transaction(async (repos) => {
      const finalized = await repos.refunds.update(reservation.refundId, {
        providerRefundId: dto.providerRefundId,
        status: resolveInitialRefundStatus(dto.status),
      });
      await repos.auditLogs.create({
        tenantId: this.deps.tenantId ?? null,
        correlationId,
        actorType: input.authorization?.actorType ?? null,
        actorId: input.authorization?.actorId ?? null,
        action: 'payment.refunded',
        resourceType: 'payment',
        resourceId: payment.id,
        before: { refundedAmount: reservation.beforeRefunded, status: reservation.beforeStatus },
        after: { refundedAmount: reservation.afterRefunded, status: reservation.afterStatus },
        metadata: { refundId: reservation.refundId, amount: reservation.requested },
        ipAddress: null,
        userAgent: null,
      });
      return finalized;
    });
  }

  private async reserve(
    storage: NonNullable<BillingDependencies['storage']>,
    payment: { id: string; providerPaymentId: string; currency: string; amount: number },
    input: RefundPaymentActionInput,
  ): Promise<RefundReservation> {
    for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
      const reservation = await this.tryReserve(storage, payment, input);
      if (reservation) {
        return reservation;
      }
    }
    throw new PayableError(`Refund reservation conflicted for payment ${payment.id}`, {
      code: 'REFUND_RESERVATION_CONFLICT',
      context: { paymentId: payment.id },
    });
  }

  private tryReserve(
    storage: NonNullable<BillingDependencies['storage']>,
    payment: { id: string; providerPaymentId: string; currency: string; amount: number },
    input: RefundPaymentActionInput,
  ): Promise<RefundReservation | null> {
    return storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(payment.id, this.deps.tenantId);
      if (!fresh) {
        throw new PayableError(`Payment not found: ${input.paymentId}`, {
          code: 'PAYMENT_NOT_FOUND',
        });
      }
      const remaining = fresh.amount - fresh.refundedAmount;
      const requested = input.amount?.amount() ?? remaining;
      if (remaining <= 0 || requested > remaining) {
        throw new PayableError(`Refund of ${requested} exceeds remaining ${remaining}`, {
          code: 'REFUND_EXCEEDS_REMAINING',
          context: { paymentId: fresh.id, requested, remaining },
        });
      }
      const refundedAmount = fresh.refundedAmount + requested;
      const machine = new PaymentStateMachine(fresh.status);
      const updated = refundedAmount >= fresh.amount ? machine.refund() : machine.partiallyRefund();
      const reserved = await repos.payments.updateRefundedAmountIfUnchanged(
        fresh.id,
        fresh.refundedAmount,
        { refundedAmount, status: updated.current() },
        this.deps.tenantId,
      );
      if (!reserved) {
        return null;
      }
      const refund = await repos.refunds.create({
        tenantId: this.deps.tenantId ?? null,
        paymentId: fresh.id,
        provider: this.deps.providerName,
        providerRefundId: null,
        status: 'pending',
        currency: fresh.currency,
        amount: requested,
        reason: input.reason ?? null,
      });
      return {
        refundId: refund.id,
        requested,
        beforeRefunded: fresh.refundedAmount,
        beforeStatus: fresh.status,
        afterRefunded: refundedAmount,
        afterStatus: updated.current(),
      };
    });
  }

  private async releaseReservation(
    storage: NonNullable<BillingDependencies['storage']>,
    paymentId: string,
    reservation: RefundReservation,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
      const released = await storage.transaction(async (repos) => {
        const fresh = await repos.payments.findByIdForUpdate(paymentId, this.deps.tenantId);
        if (!fresh) {
          await repos.refunds.update(reservation.refundId, { status: 'failed' });
          return true;
        }
        const refundedAmount = Math.max(0, fresh.refundedAmount - reservation.requested);
        const status: PaymentStatus = refundedAmount <= 0 ? 'succeeded' : 'partially_refunded';
        const reverted = await repos.payments.updateRefundedAmountIfUnchanged(
          fresh.id,
          fresh.refundedAmount,
          { refundedAmount, status },
          this.deps.tenantId,
        );
        if (reverted) {
          await repos.refunds.update(reservation.refundId, { status: 'failed' });
        }
        return reverted;
      });
      if (released) {
        return;
      }
    }
    await storage.transaction(async (repos) => {
      await repos.refunds.update(reservation.refundId, { status: 'failed' });
    });
  }
}
