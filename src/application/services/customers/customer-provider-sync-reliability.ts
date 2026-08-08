import type { CustomerCapable } from '../../../domain/contracts/payment-provider.contract';
import type { Customer } from '../../../domain/entities/customer.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { hashRequest } from '../../../support/hash/request-hash';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { CustomerProviderSyncAttempt } from './customer-provider-sync-lifecycle';

export async function customerUpdateIdempotencyKey(
  customer: Customer,
  provider: string,
  providerCustomerId: string,
): Promise<IdempotencyKey> {
  const digest = await hashRequest({
    version: 1,
    tenantId: customer.tenantId,
    provider,
    providerCustomerId,
    billableType: customer.billableType,
    billableId: customer.billableId,
    email: customer.email,
    name: customer.name,
  });
  return IdempotencyKey.of(`customer:update:v1:${digest}`);
}

export function requiresManualCreateReconciliation(
  provider: CustomerCapable,
  error: unknown,
): boolean {
  if (provider.customerCreateIdempotency === 'native') {
    return false;
  }
  if (!(error instanceof PayableError)) {
    return true;
  }
  return ['PROVIDER_ERROR', 'PROVIDER_REQUEST_TIMEOUT'].includes(error.code);
}

export function assertDurableCustomerCreate(
  provider: CustomerCapable,
  dependencies: BillingDependencies,
): void {
  if (provider.customerCreateIdempotency === 'native') {
    return;
  }
  if (dependencies.storage?.customerProviderSyncStates) {
    return;
  }
  throw new PayableError('Customer creation requires durable synchronization state', {
    code: 'CUSTOMER_PROVIDER_DURABLE_SYNC_REQUIRED',
    context: { provider: dependencies.providerName },
  });
}

export async function awaitCustomerProviderSync(
  dependencies: BillingDependencies,
  customerId: string,
  attempt: CustomerProviderSyncAttempt,
): Promise<string | null> {
  const storage = dependencies.storage;
  const syncStates = storage?.customerProviderSyncStates;
  if (!storage || !syncStates || !attempt.leaseExpiresAt) {
    return null;
  }
  for (;;) {
    const state = await syncStates.findByCustomerAndProvider(
      customerId,
      dependencies.providerName,
      dependencies.tenantId ?? null,
    );
    if (state?.status !== 'pending') {
      const binding = await storage.customerProviderBindings.findByCustomerAndProvider(
        customerId,
        dependencies.providerName,
        dependencies.tenantId ?? null,
      );
      return state?.status === 'synchronized' ? (binding?.providerCustomerId ?? null) : null;
    }
    if (dependencies.clock.now().getTime() >= attempt.leaseExpiresAt.getTime()) {
      return null;
    }
    await waitForFollowerPoll();
  }
}

export function unresolvedCustomerReconciliationError(
  customerId: string,
  provider: string,
  failureCode: string | null,
): PayableError {
  return new PayableError(`Customer ${customerId} requires manual ${provider} reconciliation`, {
    code: 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED',
    context: { customerId, provider, failureCode },
  });
}

function waitForFollowerPoll(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 10));
}
