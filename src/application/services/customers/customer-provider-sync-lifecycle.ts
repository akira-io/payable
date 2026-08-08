import type { CustomerProviderSyncState } from '../../../domain/entities/customer-provider-sync-state.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class CustomerProviderSyncLifecycle {
  constructor(private readonly dependencies: BillingDependencies) {}

  async begin(
    customerId: string,
    allowReconciliationRepair = false,
    allowExpiredLeaseReclaim = false,
  ): Promise<CustomerProviderSyncAttempt> {
    const id = CorrelationId.generate().toString();
    const repository = this.dependencies.storage?.customerProviderSyncStates;
    if (!repository) {
      return { id, number: 1, acquired: true, leaseExpiresAt: null, previous: null };
    }
    const leaseExpiresAt = new Date(
      this.dependencies.clock.now().getTime() + CUSTOMER_PROVIDER_SYNC_LEASE_MS,
    );
    const claim = await repository.beginAttempt({
      tenantId: this.tenantId(),
      customerId,
      provider: this.dependencies.providerName,
      lastAttemptedAt: this.dependencies.clock.now(),
      attemptOwnerId: id,
      leaseExpiresAt,
      allowReconciliationRepair,
      allowExpiredLeaseReclaim,
    });
    return {
      id,
      number: claim.state.attempts,
      acquired: claim.acquired,
      leaseExpiresAt: claim.state.leaseExpiresAt,
      previous: claim.previous,
    };
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
      const syncStates = repositories.customerProviderSyncStates;
      if (syncStates) {
        const completed = await syncStates.completeAttempt(
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
            attemptOwnerId: null,
            leaseExpiresAt: null,
          },
          { attempts: attempt.number, ownerId: attempt.id },
        );
        if (!completed) {
          return;
        }
      }
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

  async reconciliationRequired(
    customerId: string,
    providerCustomerId: string | null,
    attempt: CustomerProviderSyncAttempt,
    error: unknown,
    synchronizedAt: Date | null = null,
  ): Promise<CustomerProviderSyncState | undefined> {
    const recorded = await this.record({
      customerId,
      providerCustomerId,
      attempt,
      status: 'reconciliation_required',
      failureCode: errorCode(error, 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED'),
      synchronizedAt,
    });
    const lostBinding = errorCode(error, '') === 'CUSTOMER_PROVIDER_BINDING_CONFLICT';
    if (
      (!recorded || lostBinding) &&
      providerCustomerId &&
      this.dependencies.storage?.customerProviderSyncStates
    ) {
      await this.recordOrphan(customerId, providerCustomerId, attempt, error);
    }
    return recorded;
  }

  private async recordOrphan(
    customerId: string,
    providerCustomerId: string,
    attempt: CustomerProviderSyncAttempt,
    error: unknown,
  ): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return;
    }
    const failureCode = errorCode(error, 'CUSTOMER_PROVIDER_RECONCILIATION_REQUIRED');
    await storage.transaction(async (repositories) => {
      await repositories.auditLogs.create({
        tenantId: this.tenantId(),
        correlationId: attempt.id,
        actorType: null,
        actorId: null,
        action: 'customer.provider.orphaned',
        resourceType: 'customer',
        resourceId: customerId,
        before: null,
        after: {
          provider: this.dependencies.providerName,
          providerCustomerId,
          status: 'reconciliation_required',
        },
        metadata: { provider: this.dependencies.providerName, providerCustomerId, failureCode },
        ipAddress: null,
        userAgent: null,
      });
      await repositories.outboxEvents.create({
        tenantId: this.tenantId(),
        correlationId: attempt.id,
        eventType: 'customer.provider.orphaned.v1',
        eventVersion: 1,
        payload: {
          customerId,
          provider: this.dependencies.providerName,
          providerCustomerId,
          failureCode,
          tenantId: this.tenantId(),
        },
        dedupeKey: `customer-provider-orphan:${attempt.id}`,
      });
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
          attemptOwnerId: null,
          leaseExpiresAt: null,
        },
        { attempts: input.attempt.number, ownerId: input.attempt.id },
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
  readonly acquired: boolean;
  readonly leaseExpiresAt: Date | null;
  readonly previous: CustomerProviderSyncState | null;
}

export const CUSTOMER_PROVIDER_SYNC_LEASE_MS = 30_000;

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
