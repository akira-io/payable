import { PayableError } from '../../src/domain/errors/payable-error';
import type { Payable } from '../../src/payable';

const NOW = new Date('2026-08-25T12:00:00.000Z');

export function migrationAdapterPayable(): Payable {
  return {
    subscriptionPriceMigrations(tenantId?: string | null) {
      const migration = (
        id = 'migration-1',
        status = 'previewed',
        timing: {
          effectiveTiming: 'immediate' | 'nextRenewal' | 'scheduled';
          effectiveAt?: Date;
        } = {
          effectiveTiming: 'immediate',
        },
      ) => ({
        id,
        tenantId: tenantId ?? null,
        subscriptionId: 'subscription-1',
        primaryItemId: 'item-1',
        sourcePriceId: 'price-old',
        targetPriceId: 'price-new',
        sourcePrice: { ...price('price-old', 1_000), secret: 'source-extra' },
        targetPrice: { ...price('price-new', 2_000), secret: 'target-extra' },
        currentItems: [{ id: 'item-1', priceId: 'price-old', quantity: 1, secret: 'item-extra' }],
        proposedItems: [{ id: 'item-1', priceId: 'price-new', quantity: 1, secret: 'item-extra' }],
        effectiveTiming: timing.effectiveTiming,
        effectiveAt: timing.effectiveAt ?? null,
        prorationPolicy: 'prorateImmediately' as const,
        paymentFailurePolicy: 'preventChange' as const,
        immediateAdjustment: {
          direction: 'charge' as const,
          amount: 1_000,
          currency: 'USD',
          secret: 'adjustment-extra',
        },
        nextRenewal: { amount: 2_000, currency: 'USD', date: NOW, secret: 'renewal-extra' },
        currentRenewalDate: NOW,
        warnings: [],
        providerLimitations: [],
        previewToken: 'preview-token',
        calculatedAt: NOW,
        expiresAt: new Date('2026-08-25T12:15:00.000Z'),
        requestHash: 'private-request-hash',
        providerBindingId: 'private-provider-binding',
        status,
        attemptCount: 0,
        executionToken: 'private-execution-token',
        failureCode: null,
        failureMessage: null,
        scheduledAt: null,
        executionStartedAt: null,
        appliedAt: null,
        failedAt: null,
        reconciliationRequiredAt: null,
        reconciliationOutcome: null,
        reconciliationEvidenceReference: null,
        reconciliationResolvedAt: null,
        reconciliationObservationEvidenceReference: null,
        reconciliationObservedAt: null,
        cancelledAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        providerEvidence: { provider: 'stripe', providerSubscriptionId: 'sub_remote' },
        provider: 'stripe',
        providerSubscriptionId: 'sub_remote',
      });
      return {
        preview: async (input: {
          idempotencyKey: string;
          timing:
            | { effectiveTiming: 'immediate' | 'nextRenewal' }
            | { effectiveTiming: 'scheduled'; effectiveAt: Date };
        }) => migration(`created-${tenantId}-${input.idempotencyKey}`, 'previewed', input.timing),
        list: async (input: { cursor?: string; limit?: number }) => ({
          items: [migration(`listed-${tenantId}-${input.limit}-${input.cursor}`)],
          hasMore: true,
          nextCursor: 'next-cursor',
        }),
        retrieve: async (id: string) =>
          id === 'failed'
            ? migration(`retrieved-${tenantId}-${id}`, 'failed')
            : migration(`retrieved-${tenantId}-${id}`),
        approve: async (id: string, input: { idempotencyKey: string }) => {
          if (id === 'unsafe-error') {
            throw new PayableError('stripe card diagnostic secret', { code: 'STRIPE_RAW_DECLINE' });
          }
          if (id === 'provider-not-applied') {
            throw new PayableError('raw provider rejection details', {
              code: 'SUBSCRIPTION_MIGRATION_PROVIDER_NOT_APPLIED',
            });
          }
          if (id === 'mutation-claim-recovery') {
            throw new PayableError('raw active claim storage detail', {
              code: 'SUBSCRIPTION_MUTATION_RECONCILIATION_REQUIRED',
              correlationId: 'correlation-safe-mcp',
              context: {
                claimReference: 'claim-safe-mcp',
                ownerToken: 'must-not-leak',
              },
            });
          }
          if (id === 'persistence-error') {
            throw new PayableError('provider result and secret key failed to persist', {
              code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED',
              correlationId: 'corr-migration-persistence',
            });
          }
          return migration(`approved-${tenantId}-${id}-${input.idempotencyKey}`, 'applied');
        },
        cancel: async (id: string, input: { idempotencyKey: string }) =>
          migration(`cancelled-${tenantId}-${id}-${input.idempotencyKey}`, 'cancelled'),
        retry: async (id: string, input: { idempotencyKey: string }) =>
          migration(`retried-${tenantId}-${id}-${input.idempotencyKey}`, 'applied'),
      };
    },
  } as unknown as Payable;
}

function price(id: string, amount: number) {
  return {
    id,
    productId: 'product-1',
    amount,
    currency: 'USD',
    interval: 'month',
    intervalCount: 1,
  };
}
