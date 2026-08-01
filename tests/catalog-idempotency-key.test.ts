import { describe, expect, it } from 'vitest';
import type { CatalogMutationOptions } from '../src/application/builders/catalog-mutation-options';
import {
  catalogIdempotencyScope,
  deriveCatalogProviderKey,
  validateCatalogIdempotencyKey,
} from '../src/application/services/catalog/catalog-idempotency-key';
import { InvalidIdempotencyKeyError } from '../src/domain/errors/invalid-idempotency-key.error';

describe('catalog idempotency key', () => {
  it('accepts a caller key without normalizing it', () => {
    const options: CatalogMutationOptions = { idempotencyKey: 'order-123' };

    expect(validateCatalogIdempotencyKey(options.idempotencyKey)).toBe('order-123');
  });

  it.each([
    '',
    '   ',
    ' key',
    'key ',
    'x'.repeat(256),
  ])('rejects invalid caller key %j', (callerKey) => {
    expect(() => validateCatalogIdempotencyKey(callerKey)).toThrow(InvalidIdempotencyKeyError);
  });

  it('counts caller key length by Unicode code points', () => {
    expect([...'😀'.repeat(255)].length).toBe(255);
    expect(validateCatalogIdempotencyKey('😀'.repeat(255))).toBe('😀'.repeat(255));
  });

  it('scopes catalog mutations by encoded provider and action', () => {
    expect(catalogIdempotencyScope('stripe primary', 'product.create')).toBe(
      'catalog:stripe%20primary:catalog.product.create',
    );
  });

  it('derives a deterministic provider-safe key scoped to the catalog mutation', async () => {
    const input = {
      tenantId: 'tenant-a',
      providerName: 'stripe-primary',
      action: 'product.create' as const,
      callerKey: 'order-123',
    };

    const derivedKey = await deriveCatalogProviderKey(input);
    const sameKey = await deriveCatalogProviderKey(input);
    const changedTenant = await deriveCatalogProviderKey({ ...input, tenantId: 'tenant-b' });
    const changedProvider = await deriveCatalogProviderKey({
      ...input,
      providerName: 'stripe-secondary',
    });
    const changedAction = await deriveCatalogProviderKey({ ...input, action: 'product.update' });
    const changedCallerKey = await deriveCatalogProviderKey({ ...input, callerKey: 'order-124' });

    expect(derivedKey).toMatch(/^payable:catalog:v1:[0-9a-f]{64}$/);
    expect(derivedKey).toBe(sameKey);
    expect(derivedKey).not.toBe(changedTenant);
    expect(derivedKey).not.toBe(changedProvider);
    expect(derivedKey).not.toBe(changedAction);
    expect(derivedKey).not.toBe(changedCallerKey);
    expect([...derivedKey].length).toBeLessThanOrEqual(255);
  });
});
