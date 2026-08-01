import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const catalogLifecycle = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');
const knexStorage = readFileSync('docs/persistence/21-storage-knex.md', 'utf8');
const prismaStorage = readFileSync('docs/persistence/21b-storage-prisma.md', 'utf8');
const domainEvents = readFileSync('docs/domain/34-domain-events.md', 'utf8');

describe('catalog persistence documentation', () => {
  it('documents provider-first recovery without unsafe retries', () => {
    expect(catalogLifecycle).toContain('CATALOG_PERSISTENCE_FAILED');
    expect(catalogLifecycle).toContain(
      'provider mutation cannot share a transaction with local SQL storage',
    );
    expect(catalogLifecycle).toContain('providerResourceId');
    expect(catalogLifecycle).toContain('correlationId');
    expect(catalogLifecycle).toContain('issue #997');
  });

  it.each([
    ['Knex', knexStorage],
    ['Prisma', prismaStorage],
  ])('documents the %s local catalog transaction', (_driver, documentation) => {
    expect(documentation).toContain('product, price, audit, and outbox');
    expect(documentation).toContain('compare-and-set');
    expect(documentation).toContain('read-after-failure');
  });

  it('documents every durable catalog event and its normalized payload', () => {
    for (const eventType of [
      'product.created.v1',
      'product.updated.v1',
      'product.activated.v1',
      'product.archived.v1',
      'price.created.v1',
      'price.activated.v1',
      'price.archived.v1',
    ]) {
      expect(domainEvents).toContain(eventType);
    }

    for (const field of [
      'action',
      'resourceType',
      'resourceId',
      'provider',
      'providerResourceId',
      'tenantId',
      'state',
    ]) {
      expect(domainEvents).toContain(`\`${field}\``);
    }
  });
});
