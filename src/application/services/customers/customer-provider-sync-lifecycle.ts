import type { CustomerProviderSyncState } from '../../../domain/entities/customer-provider-sync-state.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class CustomerProviderSyncLifecycle {
  constructor(private readonly dependencies: BillingDependencies) {}

  async begin(customerId: string): Promise<CustomerProviderSyncAttempt> {
    const id = CorrelationId.generate().toString();
    const repository = this.dependencies.storage?.customerProviderSyncStates;
    if (!repository) {
      return { id, number: 1 };
    }
    const state = await repository.beginAttempt({
      tenantId: this.tenantId(),
      customerId,
      provider: this.dependencies.providerName,
      lastAttemptedAt: this.dependencies.clock.now(),
    });
    return { id, number: state.attempts };
  }

  async synchronized(
    customerId: string,
    providerCustomerId: string,
    attempt: CustomerProviderSyncAttempt,
  ): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return;
    }
    const synchronizedAt = this.dependencies.clock.now();
    await storage.transaction(async (repositories) => {
      await repositories.customerProviderSyncStates?.completeAttempt(
        {
          tenantId: this.tenantId(),
          customerId,
          provider: this.dependencies.providerName,
          status: 'synchronized',
          providerCustomerId,
          attempts: attempt.number,
          lastAttemptedAt: synchronizedAt,
          synchronizedAt,
          failureCode: null,
        },
        attempt.number,
      );
      await repositories.auditLogs.create({
        tenantId: this.tenantId(),
        correlationId: attempt.id,
        actorType: null,
        actorId: null,
        action: 'customer.provider.synchronized',
        resourceType: 'customer',
        resourceId: customerId,
        before: null,
        after: {
          provider: this.dependencies.providerName,
          providerCustomerId,
          status: 'synchronized',
        },
        metadata: { provider: this.dependencies.providerName, providerCustomerId },
        ipAddress: null,
        userAgent: null,
      });
      await repositories.outboxEvents.create({
        tenantId: this.tenantId(),
        correlationId: attempt.id,
        eventType: 'customer.provider.synchronized.v1',
        eventVersion: 1,
        payload: {
          customerId,
          provider: this.dependencies.providerName,
          providerCustomerId,
          tenantId: this.tenantId(),
        },
        dedupeKey: `customer-provider-sync:${attempt.id}`,
      });
    });
  }

  failed(
    customerId: string,
    attempt: CustomerProviderSyncAttempt,
    error: unknown,
    providerCustomerId: string | null = null,
    synchronizedAt: Date | null = null,
  ): Promise<CustomerProviderSyncState | undefined> {
    return this.record({
      customerId,
      providerCustomerId,
      attempt,
      status: 'failed',
      failureCode: errorCode(error, 'CUSTOMER_PROVIDER_SYNC_FAILED'),
      synchronizedAt,
    });
  }

  reconciliationRequired(
    customerId: string,
    providerCustomerId: string | null,
    attempt: CustomerProviderSyncAttempt,
    error: unknown,
    synchronizedAt: Date | null = null,
  ): Promise<CustomerProviderSyncState | undefined> {
    return this.record({
      customerId,
      providerCustomerId,
      attempt,
      status: 'reconciliation_required',
      failureCode: errorCode(error, 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED'),
      synchronizedAt,
    });
  }

  private async record(input: {
    customerId: string;
    providerCustomerId: string | null;
    attempt: CustomerProviderSyncAttempt;
    status: 'failed' | 'reconciliation_required';
    failureCode: string;
    synchronizedAt: Date | null;
  }): Promise<CustomerProviderSyncState | undefined> {
    const repository = this.dependencies.storage?.customerProviderSyncStates;
    if (!repository) {
      return undefined;
    }
    return (
      (await repository.completeAttempt(
        {
          tenantId: this.tenantId(),
          customerId: input.customerId,
          provider: this.dependencies.providerName,
          status: input.status,
          providerCustomerId: input.providerCustomerId,
          attempts: input.attempt.number,
          lastAttemptedAt: this.dependencies.clock.now(),
          synchronizedAt: input.synchronizedAt,
          failureCode: input.failureCode,
        },
        input.attempt.number,
      )) ?? undefined
    );
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
}

export interface CustomerProviderSyncAttempt {
  readonly id: string;
  readonly number: number;
}

function errorCode(error: unknown, fallback: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return fallback;
}
