import {
  type CheckoutSessionReconciliationResult,
  isCheckoutSessionReconciliationCapable,
  type UnsettledCheckoutSession,
} from '../../../domain/contracts/checkout-session-reconciliation.contract';
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
    const result = await provider.reconcileCheckoutSession({
      checkoutSessionId: input.checkoutSessionId,
    });
    if (result.outcome === 'settled') {
      return { ...result, paymentUpdated: false };
    }
    const tenantId = input.tenantId ?? this.deps.tenantId ?? null;
    const storage = this.deps.storage;
    if (!storage) {
      return { ...result, paymentUpdated: false };
    }
    const existing = await storage.payments.findByProviderId(
      this.deps.providerName,
      result.checkoutSessionId,
      tenantId,
    );
    if (!existing) {
      return { ...result, paymentUpdated: false };
    }
    const paymentUpdated = await this.close(existing, result, tenantId);
    return { ...result, paymentUpdated };
  }

  private async close(
    existing: Payment,
    result: UnsettledCheckoutSession,
    tenantId: string | null,
  ): Promise<boolean> {
    const storage = this.deps.storage;
    if (!storage) return false;
    const correlationId = CorrelationId.generate().toString();
    return await storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(existing.id, tenantId);
      if (!fresh) return false;
      this.assertAmountMatches(fresh, result);
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
        tenantId,
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

  private assertAmountMatches(payment: Payment, result: UnsettledCheckoutSession): void {
    if (
      result.amount.amount() === payment.amount &&
      result.amount.currency() === payment.currency
    ) {
      return;
    }
    throw new PayableError('Checkout session amount does not match the pending payment', {
      code: 'CHECKOUT_RECONCILIATION_PAYMENT_MISMATCH',
      context: {
        paymentId: payment.id,
        expectedAmount: payment.amount,
        expectedCurrency: payment.currency,
        actualAmount: result.amount.amount(),
        actualCurrency: result.amount.currency(),
      },
    });
  }
}
