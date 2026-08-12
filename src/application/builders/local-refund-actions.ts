import type { Repositories } from '../../domain/contracts/storage-driver.contract';
import type { Payment } from '../../domain/entities/payment.entity';
import type { Refund } from '../../domain/entities/refund.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { PaymentStateMachine } from '../../domain/states/payment-state-machine';
import { assertAuthorized } from '../policies/assert-authorized';
import { CanRefundPaymentPolicy } from '../policies/can-refund-payment.policy';
import type { LocalDependencies } from './local-dependencies';
import type { RecordLocalRefundInput } from './local-payment-inputs';

const MAX_RESERVATION_ATTEMPTS = 3;

export class LocalRefundActions {
  constructor(
    private readonly dependencies: LocalDependencies,
    private readonly policy = new CanRefundPaymentPolicy(),
  ) {}

  async record(paymentId: string, input: RecordLocalRefundInput): Promise<Refund> {
    assertAuthorized(
      this.dependencies.authorizationEnabled ?? false,
      (context) => this.policy.authorize(context),
      input.authorization,
      'refund local payment',
    );
    const tenantId = this.dependencies.tenantId ?? null;
    if (this.dependencies.idempotency && input.idempotencyKey) {
      return this.dependencies.idempotency.execute({
        key: input.idempotencyKey,
        scope: 'local-refund',
        operation: 'record',
        tenantId,
        request: this.request(paymentId, input),
        resourceType: 'refund',
        retryFailed: false,
        failurePolicy: 'reconciliation-required',
        run: () => this.persist(paymentId, input),
        revive: async (response) => {
          const refund = await this.storage().refunds.findById(
            (response as { id: string }).id,
            tenantId,
          );
          return refund ?? (response as Refund);
        },
      });
    }
    return this.persist(paymentId, input);
  }

  private async persist(paymentId: string, input: RecordLocalRefundInput): Promise<Refund> {
    for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1) {
      const refund = await this.tryPersist(paymentId, input);
      if (refund) {
        return refund;
      }
    }
    throw new PayableError(`Refund conflicted for payment ${paymentId}`, {
      code: 'REFUND_RESERVATION_CONFLICT',
    });
  }

  private async tryPersist(
    paymentId: string,
    input: RecordLocalRefundInput,
  ): Promise<Refund | null> {
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    return storage.transaction(async (repositories) => {
      const payment = await repositories.payments.findByIdForUpdate(paymentId, tenantId);
      if (!payment) {
        throw new PayableError(`Local payment not found: ${paymentId}`, {
          code: 'PAYMENT_NOT_FOUND',
        });
      }
      if (payment.provider !== null) {
        if (input.confirmedExternally !== true) {
          throw new PayableError('Provider-backed local refunds require explicit confirmation', {
            code: 'LOCAL_REFUND_EXTERNAL_CONFIRMATION_REQUIRED',
          });
        }
        if (!input.externalReference?.trim()) {
          throw new PayableError('Provider-backed local refunds require an external reference', {
            code: 'LOCAL_REFUND_EXTERNAL_REFERENCE_REQUIRED',
          });
        }
      }
      if (payment.status !== 'succeeded' && payment.status !== 'partially_refunded') {
        throw new PayableError(`Payment ${paymentId} is not refundable`, {
          code: 'PAYMENT_NOT_REFUNDABLE',
        });
      }
      if (input.amount && input.amount.currency() !== payment.currency) {
        throw new PayableError('Refund currency must match the payment', {
          code: 'REFUND_CURRENCY_MISMATCH',
        });
      }
      const remaining = payment.amount - payment.refundedAmount;
      const amount = input.amount?.amount() ?? remaining;
      if (amount <= 0 || amount > remaining) {
        throw new PayableError('Refund exceeds the remaining payment amount', {
          code: 'REFUND_EXCEEDS_REMAINING',
        });
      }
      const refundedAmount = payment.refundedAmount + amount;
      const machine = new PaymentStateMachine(payment.status);
      const status =
        refundedAmount === payment.amount
          ? machine.refund().current()
          : machine.partiallyRefund().current();
      const updated = await repositories.payments.updateRefundedAmountIfUnchanged(
        paymentId,
        payment.refundedAmount,
        { refundedAmount, status },
        tenantId,
      );
      if (!updated) {
        return null;
      }
      const refund = await repositories.refunds.create({
        tenantId,
        paymentId,
        provider: null,
        providerRefundId: null,
        status: 'succeeded',
        currency: payment.currency,
        amount,
        reason: input.reason?.trim() || null,
        collectionMethod: input.collectionMethod,
        occurredAt: input.occurredAt ?? this.dependencies.clock.now(),
        externalReference: input.externalReference?.trim() || null,
        recordedBy: input.authorization?.actorId ?? null,
      });
      await this.recordEvidence(repositories, paymentId, input, payment, refund, status);
      return refund;
    });
  }

  private async recordEvidence(
    repositories: Repositories,
    paymentId: string,
    input: RecordLocalRefundInput,
    payment: Payment,
    refund: Refund,
    status: string,
  ): Promise<void> {
    const tenantId = this.dependencies.tenantId ?? null;
    const correlationId = globalThis.crypto.randomUUID();
    await repositories.auditLogs.create({
      tenantId,
      correlationId,
      actorType: input.authorization?.actorType ?? null,
      actorId: input.authorization?.actorId ?? null,
      action: 'payment.local_refunded',
      resourceType: 'payment',
      resourceId: paymentId,
      before: { refundedAmount: payment.refundedAmount, status: payment.status },
      after: { refundedAmount: payment.refundedAmount + refund.amount, status },
      metadata: { refundId: refund.id, amount: refund.amount },
      ipAddress: null,
      userAgent: null,
    });
    await repositories.outboxEvents.create({
      tenantId,
      correlationId,
      eventType: 'refund.local_recorded',
      eventVersion: 1,
      payload: { refundId: refund.id, paymentId, amount: refund.amount },
      dedupeKey: `refund.local_recorded:${refund.id}`,
    });
  }

  private request(paymentId: string, input: RecordLocalRefundInput): Record<string, unknown> {
    return {
      paymentId,
      amount: input.amount?.amount() ?? null,
      currency: input.amount?.currency() ?? null,
      collectionMethod: input.collectionMethod,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      externalReference: input.externalReference ?? null,
      confirmedExternally: input.confirmedExternally ?? false,
      reason: input.reason ?? null,
    };
  }

  private storage() {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Stored payment writes require a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    return storage;
  }
}
