import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../src/domain/contracts/queue-driver.contract';
import {
  BullMQQueueDriver,
  isJobExhausted,
} from '../src/infrastructure/queue/bullmq/bullmq-queue-driver';
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
      removeOnFail: { count: 1000 },
    });
    expect(
      new BullMQQueueDriver({ connection, removeOnFailCount: 50 }).jobOptions().removeOnFail,
    ).toEqual({ count: 50 });
  });

  it('keeps completed jobs for an age window so the jobId dedup outlives the job', () => {
    const connection = { host: 'localhost', port: 6379 };
    expect(new BullMQQueueDriver({ connection }).jobOptions('job_1').removeOnComplete).toEqual({
      age: 86_400,
    });
    expect(
      new BullMQQueueDriver({ connection, removeOnCompleteAgeSec: 600 }).jobOptions()
        .removeOnComplete,
    ).toEqual({ age: 600 });
  });

  it('treats a job as exhausted once attemptsMade reaches the attempt cap', () => {
    expect(isJobExhausted(5, 5)).toBe(true);
    expect(isJobExhausted(2, 5)).toBe(false);
    expect(isJobExhausted(1, 0)).toBe(true);
  });

  it('surfaces a worker startup failure through onError instead of swallowing it', async () => {
    const connection = { host: 'localhost', port: 6379 };
    const errors: Array<[string, string]> = [];
    class FailingDriver extends BullMQQueueDriver {
      protected override loadBullmq(): Promise<typeof import('bullmq')> {
        return Promise.reject(new Error('bullmq unavailable'));
      }
    }
    const driver = new FailingDriver({
      connection,
      onError: (name, error) => errors.push([name, error.message]),
    });

    driver.process('webhook', async () => {});
    await driver.settle();

    expect(errors).toEqual([['webhook', 'bullmq unavailable']]);
  });

  it('routes a dead-letter enqueue failure through onError', async () => {
    const connection = { host: 'localhost', port: 6379 };
    const errors: string[] = [];
    class FailingDriver extends BullMQQueueDriver {
      protected override loadBullmq(): Promise<typeof import('bullmq')> {
        return Promise.reject(new Error('dead-letter unavailable'));
      }
      runDeadLetter(job: unknown): void {
        (
          this as unknown as {
            deadLetterExhausted: (name: string, job: unknown, error: Error) => void;
          }
        ).deadLetterExhausted('webhook', job, new Error('original failure'));
      }
    }
    const driver = new FailingDriver({
      connection,
      onError: (_name, error) => errors.push(error.message),
    });

    driver.runDeadLetter({ data: { payload: {}, correlationId: 'c1' }, name: 'job', id: '1' });
    await driver.settle();

    expect(errors).toEqual(['dead-letter unavailable']);
  });

  it('routes a dead-letter write failure to onError instead of swallowing it', async () => {
    type FailedHandler = (job: unknown, error: Error) => void;
    let failedHandler: FailedHandler | undefined;

    let deadLetterAdds = 0;
    class FakeQueue {
      constructor(public readonly queueName: string) {}
      add(): Promise<void> {
        if (this.queueName.endsWith('.dead')) {
          deadLetterAdds += 1;
          return Promise.reject(new Error('dlq down'));
        }
        return Promise.resolve();
      }
    }
    class FakeWorker {
      constructor(
        public readonly workerName: string,
        public readonly processor: unknown,
      ) {}
      on(event: string, cb: FailedHandler): void {
        if (event === 'failed') {
          failedHandler = cb;
        }
      }
    }
    class TestDriver extends BullMQQueueDriver {
      protected override loadBullmq(): Promise<typeof import('bullmq')> {
        return Promise.resolve({
          Queue: FakeQueue,
          Worker: FakeWorker,
        } as unknown as typeof import('bullmq'));
      }
    }

    const errors: Array<[string, string]> = [];
    const driver = new TestDriver({
      connection: { host: 'localhost', port: 6379 },
      attempts: 1,
      deadLetterAttempts: 3,
      onError: (name, error) => errors.push([name, error.message]),
    });

    driver.process('webhook', async () => {});
    await driver.settle();

    failedHandler?.(
      {
        name: 'webhook',
        attemptsMade: 1,
        opts: { attempts: 1 },
        data: { payload: {}, correlationId: 'c' },
        id: 'job_1',
      },
      new Error('boom'),
    );
    await driver.settle();

    expect(errors).toEqual([['webhook', 'dlq down']]);
    expect(deadLetterAdds).toBe(3);
  });

  it('writes the dead-letter with a deterministic jobId so re-delivery dedupes', async () => {
    type FailedHandler = (job: unknown, error: Error) => void;
    let failedHandler: FailedHandler | undefined;
    const addOptions: Array<Record<string, unknown>> = [];
    class FakeQueue {
      constructor(public readonly queueName: string) {}
      add(_name: string, _data: unknown, options: Record<string, unknown>): Promise<void> {
        if (this.queueName.endsWith('.dead')) {
          addOptions.push(options);
        }
        return Promise.resolve();
      }
    }
    class FakeWorker {
      constructor(
        public readonly workerName: string,
        public readonly processor: unknown,
      ) {}
      on(event: string, cb: FailedHandler): void {
        if (event === 'failed') {
          failedHandler = cb;
        }
      }
    }
    class TestDriver extends BullMQQueueDriver {
      protected override loadBullmq(): Promise<typeof import('bullmq')> {
        return Promise.resolve({
          Queue: FakeQueue,
          Worker: FakeWorker,
        } as unknown as typeof import('bullmq'));
      }
    }

    const driver = new TestDriver({ connection: { host: 'localhost', port: 6379 }, attempts: 1 });
    driver.process('webhook', async () => {});
    await driver.settle();

    failedHandler?.(
      {
        name: 'webhook',
        attemptsMade: 1,
        opts: { attempts: 1 },
        data: { payload: {}, correlationId: 'c' },
        id: 'job_1',
      },
      new Error('boom'),
    );
    await driver.settle();

    expect(addOptions).toHaveLength(1);
    expect(addOptions[0]?.jobId).toBe('job_1.dead');
  });

  it('starts a single worker when process is called concurrently for the same job', async () => {
    let workerCount = 0;
    class FakeQueue {
      add(): Promise<void> {
        return Promise.resolve();
      }
    }
    class FakeWorker {
      constructor() {
        workerCount += 1;
      }
      on(): void {}
    }
    class TestDriver extends BullMQQueueDriver {
      protected override loadBullmq(): Promise<typeof import('bullmq')> {
        return Promise.resolve({
          Queue: FakeQueue,
          Worker: FakeWorker,
        } as unknown as typeof import('bullmq'));
      }
    }

    const driver = new TestDriver({ connection: { host: 'localhost', port: 6379 } });
    driver.process('webhook', async () => {});
    driver.process('webhook', async () => {});
    await driver.settle();

    expect(workerCount).toBe(1);
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
