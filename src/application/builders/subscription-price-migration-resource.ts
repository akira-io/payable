import type { CollectionPage } from '../../domain/dtos/collection-page.dto';
import type { SubscriptionPriceMigration } from '../../domain/entities/subscription-price-migration.entity';
import { SubscriptionPriceMigrationError } from '../../domain/errors/subscription-price-migration.error';
import { encodeSubscriptionPriceMigrationExecutionEvidence } from '../../domain/internal/subscription-price-migration-execution-evidence';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../domain/value-objects/idempotency-key';
import { hashRequest } from '../../support/hash/request-hash';
import { isUniqueConstraintViolation } from '../services/storage/is-unique-constraint-violation';
import { assertNoActivePriceMigration } from '../services/subscriptions/assert-no-active-price-migration';
import { resolvePriceMigrationEligibility } from '../services/subscriptions/resolve-price-migration-eligibility';
import { SubscriptionPriceMigrationLifecycle } from '../services/subscriptions/subscription-price-migration-lifecycle';
import { listSubscriptionPriceMigrations } from '../services/subscriptions/subscription-price-migration-list';
import {
  priceMigrationItemSnapshot,
  priceMigrationPriceSnapshot,
  reviveSubscriptionPriceMigrationReference,
} from '../services/subscriptions/subscription-price-migration-preview-values';
import type { LocalDependencies } from './local-dependencies';
import type {
  DueSubscriptionPriceMigrationsInput,
  ListSubscriptionPriceMigrationsInput,
  PreviewPriceMigrationInput,
  ResolveSubscriptionPriceMigrationInput,
  SubscriptionPriceMigrationOperationInput,
  SubscriptionPriceMigrationResource as SubscriptionPriceMigrationResourceContract,
} from './subscription-price-migration-resource.contract';

export type {
  DueSubscriptionPriceMigrationsInput,
  ListSubscriptionPriceMigrationsInput,
  PreviewPriceMigrationInput,
  ResolveSubscriptionPriceMigrationInput,
  SubscriptionPriceMigrationOperationInput,
} from './subscription-price-migration-resource.contract';

const PREVIEW_TTL_MS = 15 * 60 * 1_000;

export class SubscriptionPriceMigrationResource
  implements SubscriptionPriceMigrationResourceContract
{
  constructor(private readonly dependencies: LocalDependencies) {}

  async preview(input: PreviewPriceMigrationInput): Promise<SubscriptionPriceMigration> {
    const idempotency = this.dependencies.subscriptionChangeIdempotency;
    if (!idempotency) {
      throw new SubscriptionPriceMigrationError(
        'Subscription migration previews require durable idempotency storage',
        'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED',
      );
    }
    const eligibility = await resolvePriceMigrationEligibility(this.dependencies, input);
    const tenantId = this.dependencies.tenantId ?? null;
    const sourcePrice = priceMigrationPriceSnapshot(eligibility.sourcePrice);
    const targetPrice = priceMigrationPriceSnapshot(eligibility.targetPrice);
    const currentItems = eligibility.currentItems.map(priceMigrationItemSnapshot);
    const proposedItems = currentItems.map((item) =>
      item.id === eligibility.selectedItem.id
        ? {
            ...item,
            priceId: targetPrice.id,
            quantity: input.quantity ?? item.quantity,
          }
        : item,
    );
    if (
      input.timing.effectiveTiming === 'nextRenewal' &&
      (!(eligibility.subscription.currentPeriodEnd instanceof Date) ||
        Number.isNaN(eligibility.subscription.currentPeriodEnd.getTime()))
    ) {
      throw new SubscriptionPriceMigrationError(
        'A valid current renewal date is required for next-renewal migration',
        'SUBSCRIPTION_MIGRATION_RENEWAL_DATE_REQUIRED',
        { context: { subscriptionId: eligibility.subscription.id } },
      );
    }
    const providerPreviewInput = {
      providerSubscriptionId: eligibility.providerBinding.providerSubscriptionId,
      currentItems: eligibility.providerCurrentItems,
      proposedItems: eligibility.providerProposedItems,
      ...input.timing,
      prorationPolicy: input.prorationPolicy,
      paymentFailurePolicy: input.paymentFailurePolicy,
      renewalDate: eligibility.subscription.currentPeriodEnd,
    };
    const fingerprintInput = {
      tenantId,
      subscriptionId: eligibility.subscription.id,
      sourcePrice,
      targetPrice,
      currentItems,
      proposedItems,
      timing: input.timing,
      prorationPolicy: input.prorationPolicy,
      paymentFailurePolicy: input.paymentFailurePolicy,
      providerBindingId: eligibility.providerBinding.id,
      providerKey: eligibility.providerKey,
      providerPreviewInput,
    };
    const requestHash = await hashRequest(fingerprintInput);
    const callerKey = IdempotencyKey.of(input.idempotencyKey).toString();
    const storageKey = `subscription-price-migration-preview:v1:${await hashRequest([
      tenantId,
      callerKey,
    ])}`;
    const providerKey = `payable:subscription-price-migration-preview:v1:${await hashRequest([
      tenantId,
      eligibility.providerKey,
      eligibility.providerBinding.providerSubscriptionId,
      callerKey,
    ])}`;
    const reference = await idempotency.execute<{ migrationId: string }>({
      key: callerKey,
      storageKey,
      scope: 'subscription-price-migration-preview',
      operation: 'preview',
      request: fingerprintInput,
      resourceType: 'subscription-price-migration',
      resourceId: eligibility.subscription.id,
      tenantId,
      run: async () => {
        await assertNoActivePriceMigration(
          this.repository(),
          eligibility.subscription.id,
          tenantId,
        );
        const calculatedAt = this.dependencies.clock.now();
        const financial = await eligibility.provider.previewSubscriptionChange(
          {
            ...providerPreviewInput,
            calculatedAt,
          },
          {
            correlationId: CorrelationId.generate().toString(),
            idempotencyKey: providerKey,
            tenantId,
          },
        );
        try {
          const migration = await this.repository().createWithExecutionEvidence(
            {
              tenantId,
              subscriptionId: eligibility.subscription.id,
              primaryItemId: eligibility.primaryItem.id,
              sourcePriceId: sourcePrice.id,
              targetPriceId: targetPrice.id,
              sourcePrice,
              targetPrice,
              currentItems,
              proposedItems,
              ...(input.timing.effectiveTiming === 'scheduled'
                ? input.timing
                : { effectiveTiming: input.timing.effectiveTiming, effectiveAt: null }),
              prorationPolicy: input.prorationPolicy,
              paymentFailurePolicy: input.paymentFailurePolicy,
              immediateAdjustment: financial.immediateAdjustment,
              nextRenewal: financial.nextRenewal,
              currentRenewalDate: providerPreviewInput.renewalDate,
              warnings: financial.warnings,
              providerLimitations: financial.providerLimitations,
              previewToken: `spm_preview_${globalThis.crypto.randomUUID()}`,
              requestHash,
              calculatedAt,
              expiresAt: new Date(calculatedAt.getTime() + PREVIEW_TTL_MS),
              providerBindingId: eligibility.providerBinding.id,
              status: 'previewed',
              attemptCount: 0,
              executionToken: null,
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
            },
            encodeSubscriptionPriceMigrationExecutionEvidence(
              {
                provider: eligibility.providerKey,
                providerSubscriptionId: eligibility.providerBinding.providerSubscriptionId,
                currentItems: eligibility.providerCurrentItems,
                proposedItems: eligibility.providerProposedItems,
              },
              currentItems,
              proposedItems,
            ),
          );
          return { migrationId: migration.id };
        } catch (error) {
          if (!isUniqueConstraintViolation(error)) throw error;
          throw new SubscriptionPriceMigrationError(
            'An active migration already exists for this subscription',
            'SUBSCRIPTION_MIGRATION_STATE_CONFLICT',
            { context: { subscriptionId: eligibility.subscription.id } },
          );
        }
      },
      revive: reviveSubscriptionPriceMigrationReference,
    });
    const migration = await this.repository().findById(reference.migrationId, tenantId);
    if (!migration) {
      throw new SubscriptionPriceMigrationError(
        'Persisted subscription migration preview was not found',
        'SUBSCRIPTION_MIGRATION_NOT_FOUND',
        { context: { migrationId: reference.migrationId } },
      );
    }
    return migration;
  }

  async retrieve(id: string): Promise<SubscriptionPriceMigration> {
    const migration = await this.repository().findById(id, this.dependencies.tenantId ?? null);
    if (!migration) {
      throw new SubscriptionPriceMigrationError(
        `Subscription migration not found: ${id}`,
        'SUBSCRIPTION_MIGRATION_NOT_FOUND',
        { context: { migrationId: id } },
      );
    }
    return migration;
  }

  async approve(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).approve(id, input);
  }

  async execute(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).execute(id, input);
  }

  async settle(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).settle(id, input);
  }

  async retry(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).retry(id, input);
  }

  async cancel(id: string, input: SubscriptionPriceMigrationOperationInput) {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).cancel(id, input);
  }

  async resolve(
    id: string,
    input: ResolveSubscriptionPriceMigrationInput,
  ): Promise<SubscriptionPriceMigration> {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).resolve(id, input);
  }

  async due(
    input: DueSubscriptionPriceMigrationsInput,
  ): Promise<CollectionPage<SubscriptionPriceMigration>> {
    return new SubscriptionPriceMigrationLifecycle(this.dependencies).due(input);
  }

  async list(input: ListSubscriptionPriceMigrationsInput = {}) {
    return listSubscriptionPriceMigrations(
      this.repository(),
      this.dependencies.tenantId ?? null,
      input,
    );
  }

  private repository() {
    const repository = this.dependencies.storage?.subscriptionPriceMigrations;
    if (!repository) {
      throw new SubscriptionPriceMigrationError(
        'Subscription migration previews require canonical storage',
        'SUBSCRIPTION_MIGRATION_PREVIEW_STORAGE_REQUIRED',
      );
    }
    return repository;
  }
}
