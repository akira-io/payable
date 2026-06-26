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
  removeOnCompleteAgeSec?: number;
  deadLetterSuffix?: string;
  deadLetterAttempts?: number;
  onFailed?: (jobName: string, error: Error) => void;
  onError?: (name: string, error: Error) => void;
}

const DEFAULT_REMOVE_ON_COMPLETE_AGE_SEC = 86_400;
const DEFAULT_DEAD_LETTER_ATTEMPTS = 3;
const MAX_SETTLE_ROUNDS = 1000;

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function isJobExhausted(attemptsMade: number, attempts: number): boolean {
  return attemptsMade >= Math.max(attempts, 1);
}

export interface BullMQJobOptions extends BullMQRetryOptions {
  jobId?: string;
  removeOnComplete: { age: number };
  removeOnFail: { count: number };
}

export interface BullMQRetryOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
}

export class BullMQQueueDriver implements QueueDriver {
  private readonly queues = new Map<string, Promise<Queue>>();
  private readonly workers = new Map<string, Promise<Worker>>();
  private readonly background = new Set<Promise<unknown>>();

  constructor(private readonly options: BullMQQueueOptions) {}

  async settle(): Promise<void> {
    for (let round = 0; round < MAX_SETTLE_ROUNDS; round += 1) {
      const pending = [...this.background];
      if (pending.length === 0) {
        return;
      }
      await Promise.allSettled(pending);
    }
    if (this.background.size > 0) {
      this.options.onError?.(
        'settle',
        new Error(
          `settle abandoned ${this.background.size} background task(s) after ${MAX_SETTLE_ROUNDS} rounds`,
        ),
      );
    }
  }

  private track(task: Promise<unknown>): void {
    this.background.add(task);
    task.finally(() => this.background.delete(task));
  }

  retryOptions(): BullMQRetryOptions {
    return {
      attempts: this.options.attempts ?? 5,
      backoff: { type: 'exponential', delay: this.options.backoffMs ?? 1000 },
    };
  }

  jobOptions(jobId?: string): BullMQJobOptions {
    return {
      jobId,
      removeOnComplete: {
        age: this.options.removeOnCompleteAgeSec ?? DEFAULT_REMOVE_ON_COMPLETE_AGE_SEC,
      },
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
    this.track(
      this.startWorker(name, handler as JobHandler).catch((error) => {
        this.options.onError?.(name, asError(error));
      }),
    );
  }

  protected loadBullmq(): Promise<typeof import('bullmq')> {
    return import('bullmq');
  }

  private queueFor(name: string): Promise<Queue> {
    const existing = this.queues.get(name);
    if (existing) {
      return existing;
    }
    const created = this.createQueue(name).catch((error) => {
      this.queues.delete(name);
      throw error;
    });
    this.queues.set(name, created);
    return created;
  }

  private async createQueue(name: string): Promise<Queue> {
    const { Queue: QueueClass } = await this.loadBullmq();
    return new QueueClass(name, {
      connection: this.options.connection,
      prefix: this.options.prefix,
    });
  }

  private startWorker(name: string, handler: JobHandler): Promise<Worker> {
    const existing = this.workers.get(name);
    if (existing) {
      return existing;
    }
    const created = this.createWorker(name, handler).catch((error) => {
      this.workers.delete(name);
      throw error;
    });
    this.workers.set(name, created);
    return created;
  }

  private async createWorker(name: string, handler: JobHandler): Promise<Worker> {
    const { Worker: WorkerClass } = await this.loadBullmq();
    const worker = new WorkerClass(name, (job: Job) => this.run(handler, job), {
      connection: this.options.connection,
      prefix: this.options.prefix,
    });
    worker.on('failed', (job: Job | undefined, error: Error) => {
      this.options.onFailed?.(job?.name ?? name, error);
      if (job && isJobExhausted(job.attemptsMade, job.opts.attempts ?? 1)) {
        this.deadLetterExhausted(name, job, error);
      }
    });
    worker.on('error', (error: Error) => {
      this.options.onError?.(name, asError(error));
    });
    return worker;
  }

  private deadLetterExhausted(name: string, job: Job, error: Error): void {
    this.track(
      this.deadLetter(name, job, error).catch((deadLetterError) => {
        this.options.onError?.(name, asError(deadLetterError));
      }),
    );
  }

  private async deadLetter(name: string, job: Job, error: Error): Promise<void> {
    const attempts = Math.max(this.options.deadLetterAttempts ?? DEFAULT_DEAD_LETTER_ATTEMPTS, 1);
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        await this.writeDeadLetter(name, job, error);
        return;
      } catch (writeError) {
        lastError = writeError;
      }
    }
    throw asError(lastError);
  }

  private async writeDeadLetter(name: string, job: Job, error: Error): Promise<void> {
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
      {
        jobId: job.id ? `${job.id}:dead` : undefined,
        removeOnComplete: false,
        removeOnFail: false,
      },
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
