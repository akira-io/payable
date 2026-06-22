import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../../../domain/contracts/queue-driver.contract';

export class SyncQueueDriver implements QueueDriver {
  private readonly handlers = new Map<string, JobHandler>();

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (handler) {
      await handler(job as QueueJob);
    }
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }
}
