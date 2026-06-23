import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../src/domain/contracts/queue-driver.contract';
import { BullMQQueueDriver } from '../src/infrastructure/queue/bullmq/bullmq-queue-driver';
import { SyncQueueDriver } from '../src/infrastructure/queue/sync/sync-queue-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { countDuePendingOutbox, createTestDb } from './support/knex';

class RecordingQueue implements QueueDriver {
  readonly jobs: QueueJob[] = [];
  private readonly handlers = new Map<string, JobHandler>();

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    this.jobs.push(job as QueueJob);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }

  async runAll(): Promise<void> {
    for (const job of this.jobs) {
      await this.handlers.get(job.name)?.(job);
    }
  }
}

describe('SyncQueueDriver', () => {
  it('runs the registered handler inline', async () => {
    const queue = new SyncQueueDriver();
    const seen: QueueJob[] = [];
    queue.process('job.a', async (job) => {
      seen.push(job);
    });
    await queue.dispatch({ name: 'job.a', payload: { x: 1 }, correlationId: 'c1' });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.payload).toEqual({ x: 1 });
  });

  it('throws when no handler is registered for the job', async () => {
    const queue = new SyncQueueDriver();
    await expect(
      queue.dispatch({ name: 'job.missing', payload: {}, correlationId: 'c2' }),
    ).rejects.toThrow('No handler registered');
  });
});

describe('BullMQQueueDriver', () => {
  it('computes default and overridden retry options', () => {
    const connection = { host: 'localhost', port: 6379 };
    expect(new BullMQQueueDriver({ connection }).retryOptions()).toEqual({
      attempts: 5,
      backoff: { type: 'exponential', delay: 1000 },
    });
    expect(
      new BullMQQueueDriver({ connection, attempts: 3, backoffMs: 500 }).retryOptions(),
    ).toEqual({ attempts: 3, backoff: { type: 'exponential', delay: 500 } });
  });

  it('retains a bounded number of failed jobs instead of forever', () => {
    const connection = { host: 'localhost', port: 6379 };
    expect(new BullMQQueueDriver({ connection }).jobOptions('job_1')).toMatchObject({
      jobId: 'job_1',
      removeOnComplete: true,
      removeOnFail: { count: 1000 },
    });
    expect(
      new BullMQQueueDriver({ connection, removeOnFailCount: 50 }).jobOptions().removeOnFail,
    ).toEqual({ count: 50 });
  });
});

describe('async webhook processing', () => {
  it('dispatches a job and processes it through the worker', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new FakeProvider();
    provider.verifyResult = {
      providerEventId: 'evt_1',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      data: { id: 'in_1' },
    };
    const queue = new RecordingQueue();
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({ providers: { stripe: provider }, storage, queue });

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.name).toBe('webhook.process');
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'pending',
    );

    await queue.runAll();
    expect((await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1'))?.status).toBe(
      'processed',
    );
    expect(await countDuePendingOutbox(db, clock)).toBe(1);
    await db.destroy();
  });
});
