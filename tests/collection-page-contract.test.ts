import { describe, expect, it } from 'vitest';
import {
  decodeCollectionCursor,
  encodeCollectionCursor,
} from '../src/application/services/collections/collection-cursor';
import { normalizeCollectionLimit } from '../src/application/services/collections/normalize-collection-query';

const boundary = { createdAt: new Date('2026-08-08T10:00:00.000Z'), id: 'cus_100' };

describe('provider-neutral collection contract', () => {
  it('round-trips a cursor only against the same collection context', () => {
    const encoded = encodeCollectionCursor(boundary, {
      resource: 'customers',
      tenantId: 'tenant-a',
      filters: { email: 'ada@example.com', includeBindings: false },
    });

    expect(
      decodeCollectionCursor(encoded, {
        resource: 'customers',
        tenantId: 'tenant-a',
        filters: { includeBindings: false, email: 'ada@example.com' },
      }),
    ).toEqual(boundary);
  });

  it('round-trips Unicode filter context without corrupting the cursor', () => {
    const context = {
      resource: 'products',
      tenantId: 'tenant-a',
      filters: { name: '東京プラン' },
    };

    const encoded = encodeCollectionCursor(boundary, context);

    expect(decodeCollectionCursor(encoded, context)).toEqual(boundary);
  });

  it.each([
    {
      resource: 'products',
      tenantId: 'tenant-a',
      filters: { email: 'ada@example.com', includeBindings: false },
    },
    {
      resource: 'customers',
      tenantId: 'tenant-b',
      filters: { email: 'ada@example.com', includeBindings: false },
    },
    {
      resource: 'customers',
      tenantId: 'tenant-a',
      filters: { email: 'grace@example.com', includeBindings: false },
    },
  ])('rejects a cursor reused against another result set', (context) => {
    const encoded = encodeCollectionCursor(boundary, {
      resource: 'customers',
      tenantId: 'tenant-a',
      filters: { email: 'ada@example.com', includeBindings: false },
    });

    expect(() => decodeCollectionCursor(encoded, context)).toThrowError(
      expect.objectContaining({ code: 'COLLECTION_CURSOR_INVALID' }),
    );
  });

  it('rejects malformed cursors', () => {
    expect(() =>
      decodeCollectionCursor('not+base64', {
        resource: 'customers',
        tenantId: 'tenant-a',
        filters: {},
      }),
    ).toThrowError(expect.objectContaining({ code: 'COLLECTION_CURSOR_INVALID' }));
  });

  it.each([
    [undefined, 25],
    [1, 1],
    [100, 100],
  ])('normalizes a supported collection limit', (input, expected) => {
    expect(normalizeCollectionLimit(input)).toBe(expected);
  });

  it.each([
    0,
    -1,
    1.5,
    101,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ])('rejects an unsupported explicit collection limit', (input) => {
    expect(() => normalizeCollectionLimit(input)).toThrowError(
      expect.objectContaining({ code: 'COLLECTION_LIMIT_INVALID' }),
    );
  });
});
