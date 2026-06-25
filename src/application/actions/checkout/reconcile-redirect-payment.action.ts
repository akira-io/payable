import {
  isRedirectCallbackCapable,
  type RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
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
    const result = await provider.handleRedirectCallback(input.payload);
    const tenantId = input.tenantId ?? this.deps.tenantId ?? null;
    const storage = this.deps.storage;
    if (!storage) {
      return { ...result, paymentUpdated: false };
    }
    const payment = await storage.payments.findByProviderId(
      this.deps.providerName,
      result.providerPaymentId,
      tenantId,
    );
    if (!payment) {
      return { ...result, paymentUpdated: false };
    }
    await storage.payments.update(payment.id, { status: result.status }, tenantId);
    return { ...result, paymentUpdated: true };
  }
}
