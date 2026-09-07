import { isPaymentWebhookCapable } from '../../../domain/contracts/payment-provider.contract';
import {
  isSupersededAuthorization,
  PaymentStateMachine,
} from '../../../domain/states/payment-state-machine';
import type { WebhookReconciliation } from '../../builders/webhook-dependencies';

export async function reconcileWebhookPayment({
  deps,
  repos,
  verified,
  occurredAt,
  tenantId,
}: WebhookReconciliation): Promise<void> {
  const { provider, providerName } = deps;
  if (!isPaymentWebhookCapable(provider)) {
    return;
  }
  const dto = provider.reconcilePayment(verified);
  if (!dto) {
    return;
  }
  const local = await repos.payments.findByProviderId(
    providerName,
    dto.providerPaymentId,
    tenantId,
  );
  if (!local) {
    return;
  }
  if (isSupersededAuthorization(local, dto)) {
    return;
  }
  const machine = new PaymentStateMachine(local.status);
  if (!machine.tryTransitionTo(dto.status)) {
    return;
  }
  const status = machine.current();
  await repos.payments.update(
    local.id,
    {
      status,
      ...(status === 'authorized' && !local.authorizedAt ? { authorizedAt: occurredAt } : {}),
    },
    tenantId,
  );
}
