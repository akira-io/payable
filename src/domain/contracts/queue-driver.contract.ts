export interface QueueJob<T = unknown> {
  name: string;
  payload: T;
  correlationId: string;
  idempotencyKey?: string;
}

export type JobHandler<T = unknown> = (job: QueueJob<T>) => Promise<void>;

export interface QueueDriver {
  dispatch<T>(job: QueueJob<T>): Promise<void>;
  process<T>(name: string, handler: JobHandler<T>): void;
}
