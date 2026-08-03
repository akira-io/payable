import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { CatalogPersistenceAction } from '../../../domain/entities/catalog-mutation.entity';
import type { CatalogTransitionContext } from './catalog-persistence-coordinator';

const TRANSITION_NAMES: Record<CatalogPersistenceAction, string> = {
  'product.create': 'product.created',
  'product.update': 'product.updated',
  'product.activate': 'product.activated',
  'product.archive': 'product.archived',
  'price.create': 'price.created',
  'price.activate': 'price.activated',
  'price.archive': 'price.archived',
};

export interface CatalogTransitionRecord {
  resourceType: 'product' | 'price';
  resourceId: string;
  provider: string;
  providerResourceId: string;
  tenantId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown>;
  context: CatalogTransitionContext;
}

export async function recordCatalogTransition(
  repositories: Repositories,
  record: CatalogTransitionRecord,
): Promise<void> {
  const transitionName = TRANSITION_NAMES[record.context.action];
  await repositories.auditLogs.create({
    tenantId: record.tenantId,
    correlationId: record.context.correlationId,
    actorType: record.context.authorization?.actorType ?? null,
    actorId: record.context.authorization?.actorId ?? null,
    action: transitionName,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    before: record.before,
    after: record.after,
    metadata: {
      provider: record.provider,
      providerResourceId: record.providerResourceId,
    },
    ipAddress: null,
    userAgent: null,
  });
  await repositories.outboxEvents.create({
    tenantId: record.tenantId,
    correlationId: record.context.correlationId,
    eventType: `${transitionName}.v1`,
    eventVersion: 1,
    payload: {
      action: record.context.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      provider: record.provider,
      providerResourceId: record.providerResourceId,
      tenantId: record.tenantId,
      state: record.after,
    },
    dedupeKey: [
      'catalog',
      record.resourceType,
      record.context.action,
      record.provider,
      record.providerResourceId,
      record.context.correlationId,
    ].join(':'),
  });
}
