import {
  isRedirectCallbackCapable,
  type RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export interface RedirectCallbackInput {
  payload: Record<string, unknown>;
  tenantId?: string | null;
}

export interface ReconcileRedirectPaymentResult extends RedirectCallbackResult {
  paymentUpdated: boolean;
}

export class ReconcileRedirectPaymentAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(input: RedirectCallbackInput): Promise<ReconcileRedirectPaymentResult> {
    const provider = this.deps.provider;
    if (!isRedirectCallbackCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'redirectCallback');
    }
    if (!(await provider.verifyCallback(input.payload))) {
      throw new PayableError('Redirect callback failed verification', {
        code: 'REDIRECT_CALLBACK_INVALID',
        context: { provider: provider.name },
      });
    }
    const result = await provider.handleRedirectCallback(input.payload);
    const tenantId = input.tenantId ?? this.deps.tenantId ?? null;
    const storage = this.deps.storage;
    if (!storage) {
      return { ...result, paymentUpdated: false };
    }
    const existing = await storage.payments.findByProviderId(
      this.deps.providerName,
      result.providerPaymentId,
      tenantId,
    );
    if (!existing) {
      return { ...result, paymentUpdated: false };
    }
    const correlationId = CorrelationId.generate().toString();
    const paymentUpdated = await storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(existing.id, tenantId);
      if (!fresh) {
        return false;
      }
      const machine = new PaymentStateMachine(fresh.status);
      if (!machine.tryTransitionTo(result.status)) {
        return false;
      }
      const next = machine.current();
      await repos.payments.update(fresh.id, { status: next }, tenantId);
      await repos.auditLogs.create({
        tenantId,
        correlationId,
        actorType: null,
        actorId: null,
        action: 'payment.reconciled',
        resourceType: 'payment',
        resourceId: fresh.id,
        before: { status: fresh.status },
        after: { status: next },
        metadata: { providerPaymentId: result.providerPaymentId, source: 'redirect_callback' },
        ipAddress: null,
        userAgent: null,
      });
      return true;
    });
    return { ...result, paymentUpdated };
  }
}
