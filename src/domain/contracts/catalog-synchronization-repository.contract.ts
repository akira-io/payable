import type {
  CatalogSynchronization,
  CatalogSynchronizationResourceType,
} from '../entities/catalog-synchronization.entity';

export type NewCatalogSynchronization = Omit<
  CatalogSynchronization,
  'id' | 'createdAt' | 'updatedAt'
>;

export type CatalogSynchronizationPatch = Partial<
  Omit<
    CatalogSynchronization,
    'id' | 'tenantId' | 'provider' | 'resourceType' | 'resourceId' | 'createdAt'
  >
>;

export interface CatalogSynchronizationRepository {
  save(data: NewCatalogSynchronization): Promise<CatalogSynchronization>;
  update(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    patch: CatalogSynchronizationPatch,
    tenantId: string | null,
  ): Promise<CatalogSynchronization>;
  findByResource(
    resourceType: CatalogSynchronizationResourceType,
    resourceId: string,
    provider: string,
    tenantId: string | null,
  ): Promise<CatalogSynchronization | null>;
}
