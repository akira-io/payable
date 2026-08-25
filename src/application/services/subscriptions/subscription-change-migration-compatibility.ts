import type { SubscriptionChangePreview } from '../../../domain/dtos/subscription-change.dto';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { decodeSubscriptionPriceMigrationExecutionEvidence } from '../../../domain/internal/subscription-price-migration-execution-evidence';
import type { LocalDependencies } from '../../builders/local-dependencies';

const LEGACY_PREVIEW_PREFIX = 'scp_';

export function legacyPreviewToken(migrationId: string): string {
  return `${LEGACY_PREVIEW_PREFIX}${migrationId}`;
}

export function migrationIdFromLegacyPreviewToken(previewToken: string): string | null {
  if (!previewToken.startsWith(LEGACY_PREVIEW_PREFIX)) return null;
  const migrationId = previewToken.slice(LEGACY_PREVIEW_PREFIX.length);
  return migrationId.length === 36 ? migrationId : null;
}

export function compatibleSubscriptionChangePreviewError(error: unknown): unknown {
  if (!(error instanceof SubscriptionPriceMigrationError)) return error;
  if (error.context?.reason === 'item_ambiguous') {
    return new PayableError('Subscription item selection is ambiguous', {
      code: 'SUBSCRIPTION_ITEM_AMBIGUOUS',
      context: error.context,
    });
  }
  if (error.context?.reason === 'item_not_found') {
    return new PayableError(
      `Subscription item ${String(error.context.itemId ?? '')} was not found`,
      {
        code: 'SUBSCRIPTION_ITEM_NOT_FOUND',
        context: error.context,
      },
    );
  }
  return error;
}

export async function projectCompatibleSubscriptionChangePreview(
  dependencies: LocalDependencies,
  migration: SubscriptionPriceMigration,
): Promise<SubscriptionChangePreview> {
  const repository = dependencies.storage?.subscriptionPriceMigrations;
  const evidenceBlob = repository
    ? await repository.findExecutionEvidenceById(migration.id, dependencies.tenantId ?? null)
    : null;
  if (!evidenceBlob) {
    throw new SubscriptionPriceMigrationError(
      'Subscription migration execution evidence was not found',
      'SUBSCRIPTION_MIGRATION_PREVIEW_STALE',
      { context: { migrationId: migration.id } },
    );
  }
  const evidence = decodeSubscriptionPriceMigrationExecutionEvidence(
    evidenceBlob,
    migration.currentItems,
    migration.proposedItems,
  );
  const base = {
    previewToken: legacyPreviewToken(migration.id),
    provider: evidence.provider,
    subscriptionId: migration.subscriptionId,
    currentItems: evidence.currentItems,
    proposedItems: evidence.proposedItems,
    prorationPolicy: migration.prorationPolicy,
    paymentFailurePolicy: migration.paymentFailurePolicy,
    calculatedAt: migration.calculatedAt,
    expiresAt: migration.expiresAt,
    currentRenewalDate: migration.currentRenewalDate,
    immediateAdjustment: migration.immediateAdjustment,
    nextRenewal: migration.nextRenewal,
    warnings: migration.warnings,
    providerLimitations: migration.providerLimitations,
  };
  return migration.effectiveTiming === 'scheduled'
    ? {
        ...base,
        effectiveTiming: migration.effectiveTiming,
        effectiveAt: migration.effectiveAt,
      }
    : { ...base, effectiveTiming: migration.effectiveTiming };
}
