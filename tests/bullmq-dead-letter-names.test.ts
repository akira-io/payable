import { Job, Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { BullMQQueueDriver } from '../src/infrastructure/queue/bullmq/bullmq-queue-driver';

const connection = { host: 'localhost', port: 6379 };

type FailedHandler = (job: unknown, error: Error) => void;

function fakeBullmq() {
  const added: Array<{
    queue: string;
    name: string;
    data: unknown;
    options: Record<string, unknown>;
  }> = [];
  let failedHandler: FailedHandler | undefined;
  class FakeQueue {
    constructor(public readonly queueName: string) {}
    add(name: string, data: unknown, options: Record<string, unknown>): Promise<void> {
      added.push({ queue: this.queueName, name, data, options });
      return Promise.resolve();
    }
  }
  class FakeWorker {
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
  return { TestDriver, added, failed: (job: unknown, error: Error) => failedHandler?.(job, error) };
}

describe('BullMQ dead-letter naming', () => {
  it('accepts the catalog synchronization queue-safe job id', () => {
    class ValidatingJob extends Job {
      validate(): void {
        this.validateOptions({ data: '{}' } as ReturnType<Job['asJSON']>);
      }
    }
    const jobId = `catalog-sync-${'a'.repeat(64)}`;
    const job = Object.create(ValidatingJob.prototype) as ValidatingJob;
    Object.assign(job, { name: 'catalog.synchronize', opts: { jobId } });

    expect(() => job.validate()).not.toThrow();
  });

  it('rejects a colon suffix before any worker starts', () => {
    expect(() => new BullMQQueueDriver({ connection, deadLetterSuffix: ':dead' })).toThrow(
      expect.objectContaining({ code: 'QUEUE_DEAD_LETTER_SUFFIX_INVALID' }),
    );
    expect(() => new BullMQQueueDriver({ connection, deadLetterSuffix: '' })).toThrow(
      expect.objectContaining({ code: 'QUEUE_DEAD_LETTER_SUFFIX_INVALID' }),
    );
  });

  it('rejects the old colon-suffixed queue name in the real BullMQ Queue class', () => {
    expect(() => new Queue('webhook.process:dead', { connection })).toThrow(
      'Queue name cannot contain :',
    );
  });

  it('copies an exhausted job to the dead-letter queue where it can be found and replayed', async () => {
    const { TestDriver, added, failed } = fakeBullmq();
    const driver = new TestDriver({ connection, attempts: 1 });

    driver.process('webhook.process', async () => {});
    await driver.settle();
    failed(
      {
        name: 'webhook.process',
        attemptsMade: 1,
        opts: { attempts: 1 },
        data: { payload: { webhookEventId: 'evt_1' }, correlationId: 'corr-1' },
        id: 'job_1',
      },
      new PayableError('handler exploded', {
        code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
        context: { providerResourceId: 'prod_1', apiKey: 'secret' },
      }),
    );
    await driver.settle();

    const deadLettered = added.find((entry) => entry.queue === 'webhook.process.dead');
    expect(deadLettered).toBeDefined();
    expect(deadLettered?.queue).not.toContain(':');
    expect(deadLettered?.options.jobId).toBe('job_1.dead');
    expect(String(deadLettered?.options.jobId)).not.toContain(':');
    expect(deadLettered?.data).toMatchObject({
      payload: { webhookEventId: 'evt_1' },
      correlationId: 'corr-1',
      originalJobId: 'job_1',
      failedReason: 'handler exploded',
      failedError: {
        name: 'PayableError',
        message: 'handler exploded',
        code: 'CATALOG_SYNC_LOCAL_PERSISTENCE_FAILED',
        context: { providerResourceId: 'prod_1', apiKey: '[redacted]' },
      },
    });

    const replay = deadLettered?.data as { payload: unknown; correlationId: string };
    await driver.dispatch({
      name: 'webhook.process',
      payload: replay.payload,
      correlationId: replay.correlationId,
      idempotencyKey: 'job_1',
    });
    const replayed = added.find(
      (entry) => entry.queue === 'webhook.process' && entry.options.jobId === 'job_1',
    );
    expect(replayed?.data).toMatchObject({ payload: { webhookEventId: 'evt_1' } });
  });
});
