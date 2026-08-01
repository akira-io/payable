import { describe, expect, it } from 'vitest';
import { CatalogPersistenceError } from '../src/domain/errors/catalog-persistence.error';

describe('CatalogPersistenceError', () => {
  it('retains the confirmed remote identity and original cause', () => {
    const cause = new Error('database unavailable');
    const error = new CatalogPersistenceError(
      {
        resourceType: 'product',
        action: 'product.create',
        provider: 'stripe',
        providerResourceId: 'prod_remote',
        tenantId: 'tenant-a',
        correlationId: 'corr-catalog',
      },
      { cause },
    );

    expect(error).toMatchObject({
      code: 'CATALOG_PERSISTENCE_FAILED',
      cause,
      correlationId: 'corr-catalog',
      context: {
        resourceType: 'product',
        action: 'product.create',
        provider: 'stripe',
        providerResourceId: 'prod_remote',
        tenantId: 'tenant-a',
        correlationId: 'corr-catalog',
      },
    });
  });

  it('keeps confirmed failure identity when context contains conflicting values', () => {
    const error = new CatalogPersistenceError(
      {
        resourceType: 'product',
        action: 'product.create',
        provider: 'stripe',
        providerResourceId: 'prod_remote',
        tenantId: 'tenant-a',
        correlationId: 'corr-catalog',
      },
      {
        context: {
          resourceType: 'price',
          action: 'price.archive',
          provider: 'paddle',
          providerResourceId: 'price_conflict',
          tenantId: 'tenant-conflict',
          correlationId: 'corr-conflict',
        },
      },
    );

    expect(error.context).toMatchObject({
      resourceType: 'product',
      action: 'product.create',
      provider: 'stripe',
      providerResourceId: 'prod_remote',
      tenantId: 'tenant-a',
      correlationId: 'corr-catalog',
    });
  });
});
