import {
  isRedirectCallbackCapable,
  type RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { PaymentAuthorizedEvent } from '../../../domain/events/payment-lifecycle.event';
import { PaymentStateMachine } from '../../../domain/states/payment-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { Money } from '../../../domain/value-objects/money';
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
    let existing = await storage.payments.findByProviderId(
      this.deps.providerName,
      result.providerPaymentId,
      tenantId,
    );
    if (!existing && result.checkoutSessionId) {
      existing = await storage.payments.findByProviderId(
        this.deps.providerName,
        result.checkoutSessionId,
        tenantId,
      );
    }
    if (!existing) {
      return { ...result, paymentUpdated: false };
    }
    const correlationId = CorrelationId.generate().toString();
    const paymentUpdated = await storage.transaction(async (repos) => {
      const fresh = await repos.payments.findByIdForUpdate(existing.id, tenantId);
      if (!fresh) {
        return false;
      }
      if (
        result.amount &&
        (result.amount.amount() !== fresh.amount || result.amount.currency() !== fresh.currency)
      ) {
        throw new PayableError('Redirect callback amount does not match the pending payment', {
          code: 'REDIRECT_CALLBACK_PAYMENT_MISMATCH',
          context: {
            paymentId: fresh.id,
            expectedAmount: fresh.amount,
            expectedCurrency: fresh.currency,
            actualAmount: result.amount.amount(),
            actualCurrency: result.amount.currency(),
          },
        });
      }
      const machine = new PaymentStateMachine(fresh.status);
      if (!machine.tryTransitionTo(result.status)) {
        return false;
      }
      const next = machine.current();
      await repos.payments.update(
        fresh.id,
        {
          status: next,
          providerPaymentId: result.providerPaymentId,
          ...(next === 'authorized' ? { authorizedAt: this.deps.clock.now() } : {}),
        },
        tenantId,
      );
      await repos.auditLogs.create({
        tenantId,
        correlationId,
        actorType: null,
        actorId: null,
        action: 'payment.reconciled',
        resourceType: 'payment',
        resourceId: fresh.id,
        before: { status: fresh.status, providerPaymentId: fresh.providerPaymentId },
        after: { status: next, providerPaymentId: result.providerPaymentId },
        metadata: { providerPaymentId: result.providerPaymentId, source: 'redirect_callback' },
        ipAddress: null,
        userAgent: null,
      });
      return true;
    });
    if (paymentUpdated && result.status === 'authorized') {
      const amount = result.amount ?? Money.of(existing.amount, existing.currency);
      await this.deps.events?.emit(
        new PaymentAuthorizedEvent(
          { paymentId: existing.id, customerId: existing.customerId, amount },
          { correlationId, occurredAt: this.deps.clock.now() },
        ),
      );
    }
    return { ...result, paymentUpdated };
  }
}
