import type { ApplySubscriptionChangeInput } from '../../../domain/dtos/subscription-change.dto';
import type { SubscriptionPriceMigration } from '../../../domain/entities/subscription-price-migration.entity';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { SubscriptionPriceMigrationError } from '../../../domain/errors/subscription-price-migration.error';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { LocalDependencies } from '../../builders/local-dependencies';
import { SubscriptionPriceMigrationResource } from '../../builders/subscription-price-migration-resource';
import { projectCompatibleSubscriptionChangePreview } from './subscription-change-migration-compatibility';

export async function applyCompatibleSubscriptionChange(
  dependencies: LocalDependencies,
  migration: SubscriptionPriceMigration,
  input: ApplySubscriptionChangeInput,
  audit: (
    preview: Awaited<ReturnType<typeof projectCompatibleSubscriptionChangePreview>>,
  ) => Promise<void>,
): Promise<void> {
  const idempotency = dependencies.subscriptionChangeIdempotency;
  if (!idempotency) {
    throw new SubscriptionChangePreviewError(
      'Subscription changes require an idempotency store',
      'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED',
    );
  }
  const preview = await projectCompatibleSubscriptionChangePreview(dependencies, migration);
  const tenantId = dependencies.tenantId ?? null;
  const key = IdempotencyKey.of(input.idempotencyKey).toString();
  try {
    const reference = await idempotency.execute<{ migrationId: string }>({
      key,
      storageKey: `subscription-change-apply:${tenantId ?? ''}:${input.previewToken}`,
      scope: 'subscription-change-apply',
      operation: 'apply',
      request: preview,
      resourceType: 'subscription',
      resourceId: migration.subscriptionId,
      tenantId,
      failurePolicy: 'reconciliation-required',
      run: async () => {
        const applied = await new SubscriptionPriceMigrationResource(dependencies).approve(
          migration.id,
          { idempotencyKey: key },
        );
        await audit(preview);
        return { migrationId: applied.id };
      },
      revive: reviveMigrationReference,
    });
    await new SubscriptionPriceMigrationResource(dependencies).retrieve(reference.migrationId);
  } catch (error) {
    throw compatibleCanonicalError(error);
  }
}

function reviveMigrationReference(response: unknown): { migrationId: string } {
  const migrationId = (response as { migrationId?: unknown } | null)?.migrationId;
  if (typeof migrationId !== 'string') {
    throw new SubscriptionChangePreviewError(
      'Subscription change preview contract changed after calculation',
      'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
    );
  }
  return { migrationId };
}

function compatibleCanonicalError(error: unknown): unknown {
  if (!(error instanceof SubscriptionPriceMigrationError)) return error;
  if (error.code === 'SUBSCRIPTION_MIGRATION_PREVIEW_STALE') {
    return new SubscriptionChangePreviewError(
      'Subscription items changed after preview calculation',
      'SUBSCRIPTION_CHANGE_PREVIEW_STALE',
    );
  }
  return error;
}
