import type { ConnectionOptions, Job, Queue, Worker } from 'bullmq';
import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../../../domain/contracts/queue-driver.contract';

export interface BullMQQueueOptions {
  connection: ConnectionOptions;
  prefix?: string;
  attempts?: number;
  backoffMs?: number;
  removeOnFailCount?: number;
  deadLetterSuffix?: string;
  onFailed?: (jobName: string, error: Error) => void;
  onError?: (name: string, error: Error) => void;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isJobExhausted(attemptsMade: number, attempts: number): boolean {
  return attemptsMade >= Math.max(attempts, 1);
}

export interface BullMQJobOptions extends BullMQRetryOptions {
  jobId?: string;
  removeOnComplete: true;
  removeOnFail: { count: number };
}

export interface BullMQRetryOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
}

export class BullMQQueueDriver implements QueueDriver {
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();

  constructor(private readonly options: BullMQQueueOptions) {}

  retryOptions(): BullMQRetryOptions {
    return {
      attempts: this.options.attempts ?? 5,
      backoff: { type: 'exponential', delay: this.options.backoffMs ?? 1000 },
    };
  }

  jobOptions(jobId?: string): BullMQJobOptions {
    return {
      jobId,
      removeOnComplete: true,
      removeOnFail: { count: this.options.removeOnFailCount ?? 1000 },
      ...this.retryOptions(),
    };
  }

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    const queue = await this.queueFor(job.name);
    await queue.add(
      job.name,
      { payload: job.payload, correlationId: job.correlationId },
      this.jobOptions(job.idempotencyKey),
    );
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.startWorker(name, handler as JobHandler).catch((error) => {
      this.options.onError?.(name, asError(error));
    });
  }

  protected loadBullmq(): Promise<typeof import('bullmq')> {
    return import('bullmq');
  }

  private async queueFor(name: string): Promise<Queue> {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }
    const { Queue: QueueClass } = await this.loadBullmq();
    const queue = new QueueClass(name, {
      connection: this.options.connection,
      prefix: this.options.prefix,
    });
    this.queues.set(name, queue);
    return queue;
  }

  private async startWorker(name: string, handler: JobHandler): Promise<void> {
    if (this.workers.has(name)) {
      return;
    }
    const { Worker: WorkerClass } = await this.loadBullmq();
    const worker = new WorkerClass(name, (job: Job) => this.run(handler, job), {
      connection: this.options.connection,
      prefix: this.options.prefix,
    });
    worker.on('failed', (job: Job | undefined, error: Error) => {
      this.options.onFailed?.(job?.name ?? name, error);
      if (job && isJobExhausted(job.attemptsMade, job.opts.attempts ?? 1)) {
        void this.deadLetter(name, job, error);
      }
    });
    worker.on('error', (error: Error) => {
      this.options.onError?.(name, asError(error));
    });
    this.workers.set(name, worker);
  }

  private async deadLetter(name: string, job: Job, error: Error): Promise<void> {
    const queue = await this.queueFor(`${name}${this.options.deadLetterSuffix ?? ':dead'}`);
    const data = job.data as { payload: unknown; correlationId: string };
    await queue.add(
      job.name,
      {
        payload: data.payload,
        correlationId: data.correlationId,
        originalJobId: job.id,
        failedReason: error.message,
      },
      { removeOnComplete: false, removeOnFail: false },
    );
  }

  private async run(handler: JobHandler, job: Job): Promise<void> {
    const data = job.data as { payload: unknown; correlationId: string };
    await handler({
      name: job.name,
      payload: data.payload,
      correlationId: data.correlationId,
      idempotencyKey: job.opts.jobId,
    });
  }
}
