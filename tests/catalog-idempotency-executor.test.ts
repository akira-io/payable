import { describe, expect, it } from 'vitest';
import type { BillingDependencies } from '../src/application/builders/billing-dependencies';
import { deriveCatalogProviderKey } from '../src/application/services/catalog/catalog-idempotency-key';
import {
  revivePrice,
  reviveProduct,
} from '../src/application/services/catalog/catalog-idempotency-result';
import { CatalogMutationIdempotencyExecutor } from '../src/application/services/catalog/catalog-mutation-idempotency-executor';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { PriceDTO } from '../src/domain/dtos/price.dto';
import type { ProductDTO } from '../src/domain/dtos/product.dto';
import { Money } from '../src/domain/value-objects/money';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';

const NOW = new Date('2026-08-02T00:00:00.000Z');

const PRODUCT: ProductDTO = {
  providerProductId: 'prod_1',
  name: 'Pro',
  description: null,
  active: true,
  metadata: null,
};

function dependencies(options: {
  native?: boolean;
  store?: InMemoryIdempotencyStore;
  tenantId?: string | null;
}): BillingDependencies {
  const provider = new FakeProvider();
  if (options.native === false) {
    provider.supportedCapabilities.delete('catalogIdempotency');
  }
  const clock = new FakeClock(NOW);
  return {
    provider,
    providerName: 'stripe primary',
    clock,
    tenantId: options.tenantId,
    catalogIdempotency: options.store ? new IdempotencyService(options.store, clock) : undefined,
  };
}

describe('CatalogMutationIdempotencyExecutor', () => {
  it('runs a mutation without a caller key using only its correlation and tenant context', async () => {
    const executor = new CatalogMutationIdempotencyExecutor(
      dependencies({ native: true, tenantId: 'tenant-a' }),
    );
    const contexts: OperationContext[] = [];

    const product = await executor.execute({
      action: 'product.create',
      request: { name: 'Pro' },
      resourceType: 'product',
      run: async (context) => {
        contexts.push(context);
        return PRODUCT;
      },
      revive: reviveProduct,
    });

    expect(product).toEqual(PRODUCT);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(contexts[0]).toEqual({
      correlationId: contexts[0]?.correlationId,
      tenantId: 'tenant-a',
    });
  });

  it('uses storage and a derived provider key for a native provider', async () => {
    const store = new InMemoryIdempotencyStore();
    const executor = new CatalogMutationIdempotencyExecutor(dependencies({ native: true, store }));
    const contexts: OperationContext[] = [];
    let runs = 0;
    const mutation = {
      action: 'product.create' as const,
      callerKey: 'order-123',
      request: { name: 'Pro' },
      resourceType: 'product' as const,
      run: async (context: OperationContext) => {
        runs += 1;
        contexts.push(context);
        return PRODUCT;
      },
      revive: reviveProduct,
    };

    expect(await executor.execute(mutation)).toEqual(PRODUCT);
    expect(await executor.execute(mutation)).toEqual(PRODUCT);

    const providerKey = await deriveCatalogProviderKey({
      providerName: 'stripe primary',
      action: 'product.create',
      callerKey: 'order-123',
    });
    expect(runs).toBe(1);
    expect(contexts[0]?.idempotencyKey).toBe(providerKey);
    expect(
      await store.find('catalog:stripe%20primary:catalog.product.create:order-123'),
    ).toMatchObject({
      operation: 'catalog.product.create',
      resourceType: 'product',
      resourceId: null,
      status: 'completed',
    });
  });

  it('requires reconciliation after a non-native provider mutation fails', async () => {
    const store = new InMemoryIdempotencyStore();
    const executor = new CatalogMutationIdempotencyExecutor(dependencies({ native: false, store }));
    const contexts: OperationContext[] = [];
    let runs = 0;
    const mutation = {
      action: 'product.update' as const,
      callerKey: 'update-123',
      request: { providerProductId: 'prod_1', name: 'Pro v2' },
      resourceType: 'product' as const,
      resourceId: 'prod_1',
      run: async (context: OperationContext): Promise<ProductDTO> => {
        runs += 1;
        contexts.push(context);
        throw new Error('provider result unknown');
      },
      revive: reviveProduct,
    };

    await expect(executor.execute(mutation)).rejects.toThrow('provider result unknown');
    await expect(executor.execute(mutation)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    expect(runs).toBe(1);
    expect(contexts[0]?.idempotencyKey).toBeUndefined();
    expect(Object.hasOwn(contexts[0] ?? {}, 'idempotencyKey')).toBe(false);
  });

  it('replays an in-memory PriceDTO as a fresh Money value without rerunning', async () => {
    const store = new InMemoryIdempotencyStore();
    const executor = new CatalogMutationIdempotencyExecutor(dependencies({ native: true, store }));
    let runs = 0;
    const mutation = {
      action: 'price.create' as const,
      callerKey: 'price-123',
      request: { providerProductId: 'prod_1', unitAmount: { amount: 9900, currency: 'USD' } },
      resourceType: 'price' as const,
      run: async (): Promise<PriceDTO> => {
        runs += 1;
        return {
          providerPriceId: 'price_1',
          providerProductId: 'prod_1',
          unitAmount: Money.of(9900, 'USD'),
          interval: 'month',
          intervalCount: 1,
          description: null,
          active: true,
        };
      },
      revive: revivePrice,
    };

    const first = await executor.execute(mutation);
    const replay = await executor.execute(mutation);

    expect(first.unitAmount).toBeInstanceOf(Money);
    expect(replay.unitAmount).toBeInstanceOf(Money);
    expect(replay.unitAmount).not.toBe(first.unitAmount);
    expect(replay.unitAmount.amount()).toBe(9900);
    expect(replay.unitAmount.currency()).toBe('USD');
    expect(runs).toBe(1);
  });

  it('forwards distinct derived keys directly when native storage is unavailable', async () => {
    const defaultContexts: OperationContext[] = [];
    const tenantContexts: OperationContext[] = [];
    const mutation = (contexts: OperationContext[]) => ({
      action: 'product.create' as const,
      callerKey: 'order-123',
      request: { name: 'Pro' },
      resourceType: 'product' as const,
      run: async (context: OperationContext) => {
        contexts.push(context);
        return PRODUCT;
      },
      revive: reviveProduct,
    });

    await new CatalogMutationIdempotencyExecutor(dependencies({ native: true })).execute(
      mutation(defaultContexts),
    );
    await new CatalogMutationIdempotencyExecutor(
      dependencies({ native: true, tenantId: 'tenant-a' }),
    ).execute(mutation(tenantContexts));

    expect(defaultContexts[0]?.idempotencyKey).toMatch(/^payable:catalog:v1:[0-9a-f]{64}$/);
    expect(defaultContexts[0]?.idempotencyKey).not.toBe(tenantContexts[0]?.idempotencyKey);
  });

  it('fails before running a non-native mutation when storage is unavailable', async () => {
    const executor = new CatalogMutationIdempotencyExecutor(dependencies({ native: false }));
    let runs = 0;

    await expect(
      executor.execute({
        action: 'price.archive',
        callerKey: 'archive-123',
        request: { providerPriceId: 'price_1' },
        resourceType: 'price',
        resourceId: 'price_1',
        run: async () => {
          runs += 1;
          return revivePrice({});
        },
        revive: revivePrice,
      }),
    ).rejects.toMatchObject({
      code: 'CATALOG_IDEMPOTENCY_STORAGE_REQUIRED',
      context: { provider: 'stripe primary' },
    });
    expect(runs).toBe(0);
  });

  it('hashes only the declared request and excludes authorization context', async () => {
    const store = new InMemoryIdempotencyStore();
    const executor = new CatalogMutationIdempotencyExecutor(dependencies({ native: true, store }));
    let runs = 0;
    const mutation = (actorId: string) => ({
      action: 'product.create' as const,
      authorization: { allowed: true, actorId },
      callerKey: 'order-123',
      request: { name: 'Pro' },
      resourceType: 'product' as const,
      run: async () => {
        runs += 1;
        return PRODUCT;
      },
      revive: reviveProduct,
    });

    await executor.execute(mutation('catalog-admin'));
    await executor.execute(mutation('catalog-operator'));

    expect(runs).toBe(1);
  });
});

describe('catalog idempotency result revival', () => {
  it('reconstructs price money from a stored response', () => {
    const price = revivePrice({
      providerPriceId: 'price_1',
      providerProductId: 'prod_1',
      unitAmount: { amount: 9900, currency: 'USD' },
      interval: 'month',
      intervalCount: 1,
      description: null,
      active: true,
    });

    expect(price.unitAmount).toBeInstanceOf(Money);
    expect(price.unitAmount.amount()).toBe(9900);
    expect(price.unitAmount.currency()).toBe('USD');
  });

  it.each([reviveProduct, revivePrice])('fails closed for malformed stored responses', (revive) => {
    expect(() => revive({ active: true })).toThrowError(
      expect.objectContaining({ code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED' }),
    );
  });
});
