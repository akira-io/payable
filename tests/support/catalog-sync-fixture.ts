import { createPayable } from '../../src/create-payable';
import type { PaymentProvider } from '../../src/domain/contracts/payment-provider.contract';
import type { QueueDriver } from '../../src/domain/contracts/queue-driver.contract';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../src/domain/dtos/price.dto';
import type { CreateProductInput, ProductDTO } from '../../src/domain/dtos/product.dto';
import { PayableError } from '../../src/domain/errors/payable-error';
import { Money } from '../../src/domain/value-objects/money';
import { KnexStorageDriver } from '../../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../../src/support/clock/fake-clock';
import { FakeProvider } from './fake-provider';
import { createTestDb } from './knex';

export class SynchronizingProvider extends FakeProvider {
  productCreates = 0;
  priceCreates = 0;
  readonly synchronizationOrder: string[] = [];
  readonly priceUpdates: Array<{ providerPriceId: string; description?: string | null }> = [];
  remoteProduct?: ProductDTO | Error;
  remotePrice?: PriceDTO | Error;
  lastProductContext?: OperationContext;

  constructor() {
    super();
    for (const capability of [
      'catalogProductCreate',
      'catalogProductUpdate',
      'catalogProductArchive',
      'catalogProductReactivate',
      'catalogPriceCreate',
      'catalogPriceUpdate',
      'catalogPriceArchive',
      'catalogPriceReactivate',
      'catalogIdempotency',
    ]) {
      this.supportedCapabilities.add(capability);
    }
  }

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.productCreates += 1;
    this.synchronizationOrder.push('product');
    this.lastProductContext = context;
    return {
      providerProductId: `prod_${this.productCreates}`,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    };
  }

  override async createPrice(
    input: CreatePriceInput,
    _context?: OperationContext,
  ): Promise<PriceDTO> {
    this.priceCreates += 1;
    this.synchronizationOrder.push('price');
    return {
      providerPriceId: `price_${this.priceCreates}`,
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
      intervalCount: input.intervalCount ?? null,
      description: input.description ?? null,
      active: true,
      lookupKey: input.lookupKey ?? null,
    };
  }

  async updatePrice(input: {
    providerPriceId: string;
    description?: string | null;
  }): Promise<PriceDTO> {
    this.priceUpdates.push(input);
    return {
      providerPriceId: input.providerPriceId,
      providerProductId: 'prod_1',
      unitAmount: Money.of(2900, 'EUR'),
      interval: 'month',
      intervalCount: 1,
      description: input.description ?? null,
      active: true,
      lookupKey: null,
    };
  }

  override async retrieveProduct(id: string): Promise<ProductDTO> {
    if (this.remoteProduct instanceof Error) {
      throw this.remoteProduct;
    }
    return (
      this.remoteProduct ?? {
        providerProductId: id,
        name: 'Product',
        description: null,
        active: true,
        metadata: null,
      }
    );
  }

  override async retrievePrice(id: string): Promise<PriceDTO> {
    if (this.remotePrice instanceof Error) {
      throw this.remotePrice;
    }
    return (
      this.remotePrice ?? {
        providerPriceId: id,
        providerProductId: 'prod_1',
        unitAmount: Money.of(2900, 'EUR'),
        interval: 'month',
        intervalCount: 1,
        description: 'Monthly',
        active: true,
        lookupKey: null,
      }
    );
  }
}

export class FlakySynchronizingProvider extends SynchronizingProvider {
  readonly productIdempotencyKeys: string[] = [];

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.productCreates += 1;
    this.synchronizationOrder.push('product');
    this.productIdempotencyKeys.push(context?.idempotencyKey ?? '');
    if (this.productCreates === 1) {
      throw new PayableError('Temporary provider failure', { code: 'PROVIDER_UNAVAILABLE' });
    }
    return {
      providerProductId: 'prod_recovered',
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    };
  }
}

export class NonIdempotentFlakyProvider extends FlakySynchronizingProvider {
  constructor() {
    super();
    this.supportedCapabilities.delete('catalogIdempotency');
  }
}

export class FlakyPriceProvider extends SynchronizingProvider {
  readonly priceIdempotencyKeys: string[] = [];

  override async createPrice(
    input: CreatePriceInput,
    context?: OperationContext,
  ): Promise<PriceDTO> {
    this.priceCreates += 1;
    this.synchronizationOrder.push('price');
    this.priceIdempotencyKeys.push(context?.idempotencyKey ?? '');
    if (this.priceCreates === 1) {
      throw new PayableError('Temporary provider failure', { code: 'PROVIDER_UNAVAILABLE' });
    }
    return {
      providerPriceId: 'price_recovered',
      providerProductId: input.providerProductId,
      unitAmount: input.unitAmount,
      interval: input.interval ?? null,
      intervalCount: input.intervalCount ?? null,
      description: input.description ?? null,
      active: true,
      lookupKey: input.lookupKey ?? null,
    };
  }
}

const databases: ReturnType<typeof createTestDb>[] = [];

export async function setupCatalogSync(
  provider: FakeProvider = new SynchronizingProvider(),
  queue?: QueueDriver,
) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(new Date('2026-08-08T10:00:00.000Z'));
  const storage = new KnexStorageDriver(database, clock);
  const payable = createPayable({
    providers: { 'stripe-primary': provider },
    storage,
    clock,
    ...(queue ? { queue } : {}),
  });
  return { database, clock, payable, provider: provider as SynchronizingProvider, storage };
}

export async function setupCatalogSyncProviders(providers: Record<string, PaymentProvider>) {
  const database = createTestDb();
  databases.push(database);
  await migrate(database);
  const clock = new FakeClock(new Date('2026-08-08T10:00:00.000Z'));
  const storage = new KnexStorageDriver(database, clock);
  const payable = createPayable({ providers, storage, clock, tenant: { enabled: true } });
  return { database, clock, payable, storage };
}

export async function closeCatalogSyncDatabases(): Promise<void> {
  await Promise.all(databases.splice(0).map((database) => database.destroy()));
}
