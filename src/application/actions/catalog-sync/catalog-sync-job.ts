export const PROCESS_CATALOG_SYNC_JOB = 'catalog.synchronize';

export interface ProcessCatalogSyncJobPayload {
  providerName: string;
  tenantId: string | null;
  resourceType: 'product' | 'price';
  resourceId: string;
  correlationId: string;
  canonicalVersion: string;
  idempotencyKey: string;
}
