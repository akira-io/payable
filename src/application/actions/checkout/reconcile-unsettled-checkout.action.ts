import {
  type CheckoutSessionReconciliationResult,
  isCheckoutSessionReconciliationCapable,
  type UnsettledCheckoutSession,
} from '../../../domain/contracts/checkout-session-reconciliation.contract';
import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { Payment } from '../../../domain/entities/payment.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export interface ReconcileUnsettledCheckoutInput {
  checkoutSessionId: string;
  tenantId?: string | null;
}

export type ReconcileUnsettledCheckoutResult = CheckoutSessionReconciliationResult & {
  paymentUpdated: boolean;
};

export class ReconcileUnsettledCheckoutAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(input: ReconcileUnsettledCheckoutInput): Promise<ReconcileUnsettledCheckoutResult> {
    const provider = this.deps.provider;
    if (!isCheckoutSessionReconciliationCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'checkoutSessionReconciliation');
    }
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Checkout session reconciliation requires a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    const tenantId = input.tenantId ?? this.deps.tenantId ?? null;
    const existing = await this.owned(storage, input.checkoutSessionId, tenantId);
    const result = await provider.reconcileCheckoutSession({
      checkoutSessionId: input.checkoutSessionId,
    });
    if (result.outcome === 'settled') {
      return { ...result, paymentUpdated: false };
    }
    return { ...result, paymentUpdated: await this.close(storage, existing, result, tenantId) };
  }

  private async owned(
    storage: StorageDriver,
    checkoutSessionId: string,
    tenantId: string | null,
  ): Promise<Payment> {
    const payment = await storage.payments.findByProviderId(
      this.deps.providerName,
      checkoutSessionId,
      tenantId,
    );
    if (!payment || payment.tenantId !== tenantId) {
      throw new PayableError('No stored payment carries this checkout session id', {
        code: 'CHECKOUT_RECONCILIATION_PAYMENT_NOT_FOUND',
        context: { provider: this.deps.providerName, checkoutSessionId },
      });
    }
    return payment;
  }

  private async close(
    storage: StorageDriver,
    existing: Payment,
    result: UnsettledCheckoutSession,
    tenantId: string | null,
  ): Promise<boolean> {
    const correlationId = CorrelationId.generate().toString();
    return await storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(existing.id, tenantId);
      if (!fresh) return false;
      if (fresh.providerPaymentId !== result.checkoutSessionId) return false;
      if (fresh.status !== 'pending') return false;
      this.assertBookingCovers(fresh, result);
      const machine = new PaymentStateMachine(fresh.status);
      if (!machine.tryTransitionTo(result.status)) return false;
      const updated = await repos.payments.updateStatusIfUnchanged(
        fresh.id,
        fresh.status,
        { status: machine.current() },
        tenantId,
      );
      if (!updated) return false;
      await repos.auditLogs.create({
        tenantId: fresh.tenantId,
        correlationId,
        actorType: null,
        actorId: null,
        action: 'payment.checkout_unsettled',
        resourceType: 'payment',
        resourceId: fresh.id,
        before: { status: fresh.status },
        after: { status: machine.current() },
        metadata: {
          provider: fresh.provider,
          checkoutSessionId: result.checkoutSessionId,
          source: 'checkout_reconciliation',
        },
        ipAddress: null,
        userAgent: null,
      });
      return true;
    });
  }

  private assertBookingCovers(payment: Payment, result: UnsettledCheckoutSession): void {
    if (result.amount.currency() === payment.currency && payment.amount <= result.amount.amount()) {
      return;
    }
    throw new PayableError('Checkout session does not cover the pending payment', {
      code: 'CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH',
      context: {
        paymentId: payment.id,
        paymentAmount: payment.amount,
        paymentCurrency: payment.currency,
        checkoutAmount: result.amount.amount(),
        checkoutCurrency: result.amount.currency(),
      },
    });
  }
}
