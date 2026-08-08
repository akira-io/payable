import type { CustomerCapable } from '../../../domain/contracts/payment-provider.contract';
import type { Customer } from '../../../domain/entities/customer.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { hashRequest } from '../../../support/hash/request-hash';

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
  if (provider.customerCreateIdempotency !== 'unsupported') {
    return false;
  }
  if (!(error instanceof PayableError)) {
    return true;
  }
  return ['PROVIDER_ERROR', 'PROVIDER_REQUEST_TIMEOUT'].includes(error.code);
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
