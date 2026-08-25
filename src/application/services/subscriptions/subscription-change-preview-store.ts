import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  IdempotencyRecord,
  IdempotencyStore,
} from '../../../domain/contracts/idempotency-store.contract';
import type { SubscriptionChangePreview } from '../../../domain/dtos/subscription-change.dto';
import { IdempotencyConflictError } from '../../../domain/errors/idempotency-conflict.error';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { hashRequest } from '../../../support/hash/request-hash';

const PREVIEW_NAMESPACE = 'subscription-change-preview';

export class SubscriptionChangePreviewStore {
  constructor(
    private readonly records: IdempotencyStore,
    private readonly clock: Clock,
  ) {}

  async save(preview: SubscriptionChangePreview, tenantId: string | null): Promise<void> {
    const requestHash = await hashRequest(preview);
    const record = this.record(preview, requestHash);
    const acquired = await this.records.acquire(record, tenantId);
    if (acquired) {
      return;
    }
    const existing = await this.records.find(record.key, tenantId);
    if (existing?.requestHash !== requestHash) {
      throw new IdempotencyConflictError(preview.previewToken);
    }
  }

  async load(previewToken: string, tenantId: string | null): Promise<SubscriptionChangePreview> {
    const record = await this.records.find(this.key(previewToken), tenantId);
    if (record?.status !== 'completed' || record.response === null) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview was not found',
        'SUBSCRIPTION_CHANGE_PREVIEW_NOT_FOUND',
      );
    }
    if (record.expiresAt !== null && record.expiresAt.getTime() <= this.clock.now().getTime()) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview has expired',
        'SUBSCRIPTION_CHANGE_PREVIEW_EXPIRED',
      );
    }
    const preview = revivePreview(record.response);
    const requestHash = await hashRequest(preview);
    if (requestHash !== record.requestHash || preview.previewToken !== previewToken) {
      throw new SubscriptionChangePreviewError(
        'Subscription change preview contract changed after calculation',
        'SUBSCRIPTION_CHANGE_PREVIEW_IMMUTABLE',
      );
    }
    return preview;
  }

  private record(preview: SubscriptionChangePreview, requestHash: string): IdempotencyRecord {
    return {
      key: this.key(preview.previewToken),
      scope: PREVIEW_NAMESPACE,
      operation: 'preview',
      resourceType: 'subscription',
      resourceId: preview.subscriptionId,
      requestHash,
      response: preview,
      status: 'completed',
      lockedUntil: null,
      expiresAt: preview.expiresAt,
      lockToken: null,
    };
  }

  private key(previewToken: string): string {
    return `${PREVIEW_NAMESPACE}:${previewToken}`;
  }
}

function revivePreview(response: unknown): SubscriptionChangePreview {
  const preview = response as SubscriptionChangePreview;
  const { effectiveTiming, effectiveAt: storedEffectiveAt, ...untimedPreview } = preview;
  const revived = {
    ...untimedPreview,
    calculatedAt: new Date(untimedPreview.calculatedAt),
    expiresAt: new Date(untimedPreview.expiresAt),
    currentRenewalDate:
      untimedPreview.currentRenewalDate === null
        ? null
        : new Date(untimedPreview.currentRenewalDate),
    nextRenewal: {
      ...untimedPreview.nextRenewal,
      date:
        untimedPreview.nextRenewal.date === null ? null : new Date(untimedPreview.nextRenewal.date),
    },
  };
  return effectiveTiming === 'scheduled'
    ? { ...revived, effectiveTiming, effectiveAt: new Date(storedEffectiveAt) }
    : { ...revived, effectiveTiming };
}
