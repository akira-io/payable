import { afterEach, describe, expect, it } from 'vitest';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../src/domain/contracts/queue-driver.contract';
import {
  closeCatalogSyncDatabases,
  FlakySynchronizingProvider,
  SynchronizingProvider,
  setupCatalogSync,
} from './support/catalog-sync-fixture';

class RecoverableDispatchQueue implements QueueDriver {
  readonly inline = false;
  readonly jobs: QueueJob[] = [];
  private readonly handlers = new Map<string, JobHandler>();
  failNext = false;

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('queue unavailable');
    }
    this.jobs.push(job);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  run(index: number): Promise<void> {
    const job = this.jobs[index];
    const handler = job ? this.handlers.get(job.name) : undefined;
    if (!job || !handler) throw new Error(`Queued job is unavailable at index ${index}`);
    return handler(job);
  }
}

afterEach(closeCatalogSyncDatabases);

describe('catalog synchronization dispatch recovery', () => {
  it('redispatches a persisted request after enqueue fails', async () => {
    const queue = new RecoverableDispatchQueue();
    queue.failNext = true;
    const provider = new SynchronizingProvider();
    const { payable } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Recoverable dispatch' });
    const synchronization = payable.catalogSync('stripe-primary');

    await expect(synchronization.requestProduct(product.id)).rejects.toThrow('queue unavailable');
    await expect(synchronization.requestProduct(product.id)).resolves.toMatchObject({
      status: 'requested',
    });
    await queue.run(0);
    expect(provider.productCreates).toBe(1);
  });

  it('redispatches a persisted manual retry after enqueue fails', async () => {
    const queue = new RecoverableDispatchQueue();
    const provider = new FlakySynchronizingProvider();
    const { payable } = await setupCatalogSync(provider, queue);
    const product = await payable.products().create({ name: 'Recoverable manual retry' });
    const synchronization = payable.catalogSync('stripe-primary');
    await synchronization.requestProduct(product.id);
    await expect(queue.run(0)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    queue.failNext = true;

    await expect(synchronization.retryProduct(product.id)).rejects.toThrow('queue unavailable');
    await expect(synchronization.retryProduct(product.id)).resolves.toMatchObject({
      status: 'retrying',
      retryCount: 1,
    });
    await queue.run(1);
    expect(provider.productCreates).toBe(2);
  });
});
