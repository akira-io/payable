import type {
  JobHandler,
  QueueDriver,
  QueueJob,
} from '../../../domain/contracts/queue-driver.contract';
import { PayableError } from '../../../domain/errors/payable-error';

export class SyncQueueDriver implements QueueDriver {
  private readonly handlers = new Map<string, JobHandler>();

  async dispatch<T>(job: QueueJob<T>): Promise<void> {
    const handler = this.handlers.get(job.name);
    if (!handler) {
      throw new PayableError(`No handler registered for job: ${job.name}`, {
        code: 'QUEUE_HANDLER_MISSING',
        context: { job: job.name },
      });
    }
    await handler(job as QueueJob);
  }

  process<T>(name: string, handler: JobHandler<T>): void {
    this.handlers.set(name, handler as JobHandler);
  }
}
