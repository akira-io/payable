import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const catalogLifecycle = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');
const knexStorage = readFileSync('docs/persistence/21-storage-knex.md', 'utf8');
const prismaStorage = readFileSync('docs/persistence/21b-storage-prisma.md', 'utf8');
const domainEvents = readFileSync('docs/domain/34-domain-events.md', 'utf8');
const catalogOutboxSection =
  domainEvents.split('## Catalog outbox events')[1]?.split('## DomainEvent base')[0] ?? '';

function normalizeMarkdownProse(markdown: string): string {
  return markdown.replace(/\s+/g, ' ');
}

const catalogLifecycleProse = normalizeMarkdownProse(catalogLifecycle);
const catalogOutboxProse = normalizeMarkdownProse(catalogOutboxSection);

const CATALOG_TRANSITIONS = [
  ['product.create', 'product.created', 'product.created.v1'],
  ['product.update', 'product.updated', 'product.updated.v1'],
  ['product.activate', 'product.activated', 'product.activated.v1'],
  ['product.archive', 'product.archived', 'product.archived.v1'],
  ['price.create', 'price.created', 'price.created.v1'],
  ['price.activate', 'price.activated', 'price.activated.v1'],
  ['price.archive', 'price.archived', 'price.archived.v1'],
] as const;

describe('catalog persistence documentation', () => {
  it('documents provider-first local persistence and the price parent boundary', () => {
    expect(catalogLifecycleProse).toContain(
      'The provider confirms the mutation before Payable writes the catalog entity',
    );
    expect(catalogLifecycleProse).toContain('CATALOG_PERSISTENCE_FAILED');
    expect(catalogLifecycleProse).toContain(
      'provider mutation cannot share a transaction with local SQL storage',
    );
    expect(catalogLifecycleProse).toContain('Atomicity is limited to those local writes');
    expect(catalogLifecycleProse).toContain(
      'resolves `providerProductId` to a local product before calling the provider',
    );
    expect(catalogLifecycleProse).toContain(
      'Price activation and archival resolve their parent after the provider returns',
    );
    expect(catalogLifecycleProse).toContain('all catalog mutations remain provider-only');
  });

  it.each([
    ['Knex', knexStorage],
    ['Prisma', prismaStorage],
  ])('documents the %s local catalog transaction', (_driver, documentation) => {
    const storageProse = normalizeMarkdownProse(documentation);
    expect(storageProse).toContain('product, price, audit, and outbox');
    expect(storageProse).toContain('compare-and-set');
    expect(storageProse).toContain('read-after-failure');
    expect(storageProse).toContain('only when normalized durable state changes');
    expect(storageProse).toContain(
      'Identical state is a no-op with no update, audit record, or outbox event',
    );
  });

  it('maps every catalog mutation to its audit action and outbox event', () => {
    for (const [mutationAction, auditAction, eventType] of CATALOG_TRANSITIONS) {
      expect(catalogOutboxSection).toContain(
        `| \`${mutationAction}\` | \`${auditAction}\` | \`${eventType}\` |`,
      );
    }
  });

  it('documents the normalized catalog payload and delivery dedupe boundary', () => {
    for (const field of [
      'action',
      'resourceType',
      'resourceId',
      'provider',
      'providerResourceId',
      'tenantId',
      'state',
    ]) {
      expect(catalogOutboxProse).toContain(`\`${field}\``);
    }

    expect(catalogOutboxProse).toContain('stable outbox envelope `id`');
    expect(catalogOutboxProse).toContain(
      '`providerResourceId` identifies the catalog resource and is not a delivery dedupe key',
    );
    expect(catalogOutboxSection).not.toContain('providerEventId');
  });

  it('documents the complete recoverable error and retry boundary', () => {
    for (const contextField of [
      'resourceType',
      'action',
      'provider',
      'providerResourceId',
      'tenantId',
      'correlationId',
    ]) {
      expect(catalogLifecycleProse).toContain(`\`${contextField}\``);
    }

    expect(catalogLifecycleProse).toContain('The error `cause` preserves');
    expect(catalogLifecycleProse).toContain('reconcile `providerResourceId` with the provider');
    expect(catalogLifecycleProse).toContain('Do not blindly retry');
    expect(catalogLifecycleProse).toContain('issue #997');
  });
});
