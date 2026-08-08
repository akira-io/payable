import type { CustomerProviderSyncState } from '../../../domain/entities/customer-provider-sync-state.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class CustomerProviderSyncLifecycle {
  constructor(private readonly dependencies: BillingDependencies) {}

  async begin(customerId: string, previous: CustomerProviderSyncState | null): Promise<number> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return 1;
    }
    const attempts = (previous?.attempts ?? 0) + 1;
    await storage.customerProviderSyncStates.upsert({
      tenantId: this.tenantId(),
      customerId,
      provider: this.dependencies.providerName,
      status: 'pending',
      providerCustomerId: previous?.providerCustomerId ?? null,
      attempts,
      lastAttemptedAt: this.dependencies.clock.now(),
      synchronizedAt: previous?.synchronizedAt ?? null,
      failureCode: null,
    });
    return attempts;
  }

  async synchronized(
    customerId: string,
    providerCustomerId: string,
    attempts: number,
  ): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return;
    }
    const synchronizedAt = this.dependencies.clock.now();
    const correlationId = CorrelationId.generate().toString();
    await storage.transaction(async (repositories) => {
      await repositories.customerProviderSyncStates.upsert({
        tenantId: this.tenantId(),
        customerId,
        provider: this.dependencies.providerName,
        status: 'synchronized',
        providerCustomerId,
        attempts,
        lastAttemptedAt: synchronizedAt,
        synchronizedAt,
        failureCode: null,
      });
      await repositories.auditLogs.create({
        tenantId: this.tenantId(),
        correlationId,
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
        correlationId,
        eventType: 'customer.provider.synchronized.v1',
        eventVersion: 1,
        payload: {
          customerId,
          provider: this.dependencies.providerName,
          providerCustomerId,
          tenantId: this.tenantId(),
        },
        dedupeKey: [
          'customer-provider-sync',
          this.tenantId() ?? '',
          customerId,
          this.dependencies.providerName,
          String(attempts),
        ].join(':'),
      });
    });
  }

  failed(
    customerId: string,
    attempts: number,
    error: unknown,
    providerCustomerId: string | null = null,
  ): Promise<CustomerProviderSyncState | undefined> {
    return this.record({
      customerId,
      providerCustomerId,
      attempts,
      status: 'failed',
      failureCode: errorCode(error, 'CUSTOMER_PROVIDER_SYNC_FAILED'),
    });
  }

  reconciliationRequired(
    customerId: string,
    providerCustomerId: string,
    attempts: number,
    error: unknown,
  ): Promise<CustomerProviderSyncState | undefined> {
    return this.record({
      customerId,
      providerCustomerId,
      attempts,
      status: 'reconciliation_required',
      failureCode: errorCode(error, 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED'),
    });
  }

  private async record(input: {
    customerId: string;
    providerCustomerId: string | null;
    attempts: number;
    status: 'failed' | 'reconciliation_required';
    failureCode: string;
  }): Promise<CustomerProviderSyncState | undefined> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return undefined;
    }
    return storage.customerProviderSyncStates.upsert({
      tenantId: this.tenantId(),
      customerId: input.customerId,
      provider: this.dependencies.providerName,
      status: input.status,
      providerCustomerId: input.providerCustomerId,
      attempts: input.attempts,
      lastAttemptedAt: this.dependencies.clock.now(),
      synchronizedAt: null,
      failureCode: input.failureCode,
    });
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
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
