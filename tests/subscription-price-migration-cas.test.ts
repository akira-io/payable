import { describe, expect, it } from 'vitest';
import type { SubscriptionPriceMigrationStateCompareAndSwap } from '../src/domain/contracts';
import type { SubscriptionPriceMigrationStatus } from '../src/domain/value-objects';
import { isValidSubscriptionPriceMigrationCas } from '../src/infrastructure/storage/subscription-price-migration-cas';

const STATUSES: SubscriptionPriceMigrationStatus[] = [
  'previewed',
  'scheduled',
  'executing',
  'pending_renewal',
  'applied',
  'failed',
  'reconciliation_required',
  'cancelled',
];

const ALLOWED = new Set([
  'previewed:scheduled',
  'previewed:executing',
  'previewed:cancelled',
  'scheduled:executing',
  'scheduled:cancelled',
  'executing:applied',
  'executing:pending_renewal',
  'executing:failed',
  'executing:reconciliation_required',
  'failed:executing',
  'failed:cancelled',
  'pending_renewal:applied',
]);

describe('subscription price migration runtime CAS validation', () => {
  it('rejects every transition outside the state-machine matrix, including terminal origins', () => {
    for (const expectedStatus of STATUSES) {
      for (const nextStatus of STATUSES) {
        if (ALLOWED.has(`${expectedStatus}:${nextStatus}`)) continue;
        expect(
          isValidSubscriptionPriceMigrationCas(candidate(expectedStatus, nextStatus)),
          `${expectedStatus} -> ${nextStatus}`,
        ).toBe(false);
      }
    }
  });
});

function candidate(
  expectedStatus: SubscriptionPriceMigrationStatus,
  nextStatus: SubscriptionPriceMigrationStatus,
): SubscriptionPriceMigrationStateCompareAndSwap {
  const claimedResult =
    nextStatus === 'applied' ||
    nextStatus === 'pending_renewal' ||
    nextStatus === 'reconciliation_required';
  const claimedExpectation = claimedResult || nextStatus === 'failed';
  const expectedClaimed = expectedStatus === 'pending_renewal' || claimedExpectation;
  return {
    id: 'migration-1',
    tenantId: 'tenant-1',
    expectedStatus,
    expectedExecutionToken: expectedClaimed ? 'owner-1' : null,
    nextStatus,
    executionToken: claimedResult || nextStatus === 'executing' ? 'owner-1' : null,
    attemptCount: 1,
    failureCode: null,
    failureMessage: null,
    scheduledAt: nextStatus === 'scheduled' ? new Date('2026-08-25T10:00:00.000Z') : null,
    executionStartedAt: null,
    appliedAt: null,
    failedAt: null,
    reconciliationRequiredAt: null,
    cancelledAt: null,
    updatedAt: new Date('2026-08-25T10:00:00.000Z'),
  } as SubscriptionPriceMigrationStateCompareAndSwap;
}
