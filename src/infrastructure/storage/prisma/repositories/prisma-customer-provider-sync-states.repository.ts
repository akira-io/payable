import type { Clock } from '../../../../domain/contracts/clock.contract';
import type {
  BeginCustomerProviderSyncAttempt,
  CustomerProviderSyncAttemptClaim,
  CustomerProviderSyncStateRepository,
  ExpectedCustomerProviderSyncAttempt,
  NewCustomerProviderSyncState,
} from '../../../../domain/contracts/customer-provider-sync-state-repository.contract';
import type { CustomerProviderSyncState } from '../../../../domain/entities/customer-provider-sync-state.entity';
import {
  customerProviderSyncStateToEntity,
  customerProviderSyncStateToRow,
} from '../mappers/customer-provider-sync-state.mapper';
import type { PrismaClient } from '../prisma-client.types';
import { isPrismaUniqueViolation } from '../unique-violation';

export class PrismaCustomerProviderSyncStateRepository
  implements CustomerProviderSyncStateRepository
{
  constructor(
    private readonly client: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async beginAttempt(
    data: BeginCustomerProviderSyncAttempt,
  ): Promise<CustomerProviderSyncAttemptClaim> {
    for (;;) {
      const existing = await this.findByCustomerAndProvider(
        data.customerId,
        data.provider,
        data.tenantId,
      );
      if (!existing) {
        try {
          const now = this.clock.now();
          const row = await this.client.payableCustomerProviderSyncState.create({
            data: {
              id: globalThis.crypto.randomUUID(),
              tenantId: data.tenantId,
              tenantKey: data.tenantId ?? '',
              customerId: data.customerId,
              provider: data.provider,
              status: 'pending',
              providerCustomerId: null,
              attempts: 1,
              lastAttemptedAt: data.lastAttemptedAt,
              synchronizedAt: null,
              failureCode: null,
              attemptOwnerId: data.attemptOwnerId,
              leaseExpiresAt: data.leaseExpiresAt,
              createdAt: now,
              updatedAt: now,
            },
          });
          return {
            state: customerProviderSyncStateToEntity(row),
            acquired: true,
            previous: null,
          };
        } catch (error) {
          if (!isPrismaUniqueViolation(error)) {
            throw error;
          }
        }
        continue;
      }
      if (requiresManualReconciliation(existing) && !data.allowReconciliationRepair) {
        return { state: existing, acquired: false, previous: existing };
      }
      if (hasActiveLease(existing, this.clock.now())) {
        return { state: existing, acquired: false, previous: existing };
      }
      const updatedAt = this.clock.now();
      const attempts = existing.attempts + 1;
      const { count } = await this.client.payableCustomerProviderSyncState.updateMany({
        where: {
          ...this.key(data),
          attempts: existing.attempts,
          status: existing.status,
          attemptOwnerId: existing.attemptOwnerId,
        },
        data: {
          status: 'pending',
          attempts,
          lastAttemptedAt: data.lastAttemptedAt,
          failureCode: null,
          attemptOwnerId: data.attemptOwnerId,
          leaseExpiresAt: data.leaseExpiresAt,
          updatedAt,
        },
      });
      if (count > 0) {
        return {
          acquired: true,
          previous: existing,
          state: {
            ...existing,
            status: 'pending',
            attempts,
            lastAttemptedAt: data.lastAttemptedAt,
            failureCode: null,
            attemptOwnerId: data.attemptOwnerId,
            leaseExpiresAt: data.leaseExpiresAt,
            updatedAt,
          },
        };
      }
    }
  }

  async completeAttempt(
    data: NewCustomerProviderSyncState,
    expected: ExpectedCustomerProviderSyncAttempt,
  ): Promise<CustomerProviderSyncState | null> {
    const { count } = await this.client.payableCustomerProviderSyncState.updateMany({
      where: {
        ...this.key(data),
        attempts: expected.attempts,
        attemptOwnerId: expected.ownerId,
      },
      data: {
        ...customerProviderSyncStateToRow(data),
        attemptOwnerId: null,
        leaseExpiresAt: null,
        updatedAt: this.clock.now(),
      },
    });
    return count > 0 ? this.requirePersisted(data) : null;
  }

  async findByCustomerAndProvider(
    customerId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CustomerProviderSyncState | null> {
    const row = await this.client.payableCustomerProviderSyncState.findFirst({
      where: { customerId, provider, tenantId },
    });
    return row ? customerProviderSyncStateToEntity(row) : null;
  }

  private key(data: { tenantId: string | null; customerId: string; provider: string }) {
    return { tenantKey: data.tenantId ?? '', customerId: data.customerId, provider: data.provider };
  }

  private async requirePersisted(data: {
    tenantId: string | null;
    customerId: string;
    provider: string;
  }): Promise<CustomerProviderSyncState> {
    const persisted = await this.findByCustomerAndProvider(
      data.customerId,
      data.provider,
      data.tenantId,
    );
    if (!persisted) {
      throw new Error('Customer provider sync state row missing after write');
    }
    return persisted;
  }
}

function hasActiveLease(state: CustomerProviderSyncState, now: Date): boolean {
  return (
    state.status === 'pending' &&
    state.attemptOwnerId !== null &&
    state.leaseExpiresAt !== null &&
    state.leaseExpiresAt.getTime() > now.getTime()
  );
}

function requiresManualReconciliation(state: CustomerProviderSyncState): boolean {
  return state.status === 'reconciliation_required' && state.providerCustomerId === null;
}
