import type {
  CatalogSynchronizationOperation,
  CatalogSynchronizationResourceType,
} from '../../../domain/entities/catalog-synchronization.entity';
import { hashRequest } from '../../../support/hash/request-hash';

export interface CatalogSyncKeyInput {
  tenantId: string | null;
  provider: string;
  resourceType: CatalogSynchronizationResourceType;
  resourceId: string;
  operation: CatalogSynchronizationOperation;
  canonicalVersion: string;
}

export async function deriveCatalogSyncKey(input: CatalogSyncKeyInput): Promise<string> {
  const tenantScope = input.tenantId === null ? ['default'] : ['tenant', input.tenantId];
  const digest = await hashRequest([
    'payable-catalog-sync-v1',
    tenantScope,
    input.provider,
    input.resourceType,
    input.resourceId,
    input.operation,
    input.canonicalVersion,
  ]);
  return `payable:catalog-sync:v1:${digest}`;
}
