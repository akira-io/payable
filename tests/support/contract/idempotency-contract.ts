import { expect, it } from 'vitest';
import type { IdempotencyRecord } from '../../../src/domain/contracts/idempotency-store.contract';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

const expiringStatuses: readonly ('completed' | 'failed')[] = ['completed', 'failed'];

function createIdempotencyRecord(
  key: string,
  requestHash: string,
  overrides: Partial<IdempotencyRecord> = {},
): IdempotencyRecord {
  return {
    key,
    scope: key.split(':')[0] ?? 'catalog',
    operation: 'create',
    resourceType: null,
    resourceId: null,
    requestHash,
    response: null,
    status: 'processing',
    lockedUntil: null,
    expiresAt: null,
    ...overrides,
  };
}

export function registerIdempotencyContract(ctx: ContractContext): void {
  it('isolates idempotency records by tenant and full scoped key', async () => {
    const { idempotency } = ctx.harness();
    const product = createIdempotencyRecord('catalog.product.create:shared', 'product-a');
    const price = createIdempotencyRecord('catalog.price.create:shared', 'price-a');
    expect(await idempotency.acquire(product, 'tenant-a')).toBe(true);
    expect(await idempotency.acquire(product, 'tenant-b')).toBe(true);
    expect(await idempotency.acquire(price, 'tenant-a')).toBe(true);
    expect(await idempotency.acquire(product, 'tenant-a')).toBe(false);
    await idempotency.markCompleted(product.key, { productId: 'prod_1' }, 'tenant-a');
    expect((await idempotency.find(product.key, 'tenant-a'))?.status).toBe('completed');
    expect((await idempotency.find(product.key, 'tenant-a'))?.response).toEqual({
      productId: 'prod_1',
    });
    expect((await idempotency.find(product.key, 'tenant-b'))?.status).toBe('processing');
    expect((await idempotency.find(price.key, 'tenant-a'))?.requestHash).toBe('price-a');
  });

  it('takes over an idempotency key at its supplied lease boundary', async () => {
    const { idempotency, clock } = ctx.harness();
    const boundary = new Date(CONTRACT_BASE_TIME.getTime() + 86_400_000);
    const original = createIdempotencyRecord('catalog.product.create:long-lease', 'hash-original', {
      lockedUntil: boundary,
    });
    expect(await idempotency.acquire(original)).toBe(true);
    const takeover = createIdempotencyRecord(original.key, 'hash-takeover', {
      lockedUntil: new Date(boundary.getTime() + 30_000),
      lockToken: 'token-b',
    });
    clock.advance(86_399_999);
    expect(await idempotency.takeOver(takeover)).toBe(false);
    clock.advance(1);
    expect(await idempotency.takeOver(takeover)).toBe(true);
  });

  it.each(
    expiringStatuses,
  )('refreshes an expired %s record under one active takeover lease', async (status) => {
    const { idempotency, clock } = ctx.harness();
    const key = `catalog.product.create:expired-${status}`;
    const expired = createIdempotencyRecord(key, 'hash-original', {
      status,
      response: status === 'completed' ? { providerProductId: 'prod_old' } : null,
      expiresAt: new Date(CONTRACT_BASE_TIME),
    });
    expect(await idempotency.acquire(expired)).toBe(true);

    const leaseExpiresAt = new Date(CONTRACT_BASE_TIME.getTime() + 30_000);
    const takeover = createIdempotencyRecord(key, 'hash-takeover', {
      lockedUntil: leaseExpiresAt,
      lockToken: 'fresh-owner',
    });
    expect(await idempotency.takeOver(takeover)).toBe(true);
    clock.advance(1);
    expect(await idempotency.takeOver({ ...takeover, lockToken: 'concurrent-owner' })).toBe(false);

    expect(await idempotency.find(key)).toMatchObject({
      status: 'processing',
      requestHash: 'hash-takeover',
      response: null,
      lockedUntil: leaseExpiresAt,
      lockToken: 'fresh-owner',
      expiresAt: null,
    });
  });
}
