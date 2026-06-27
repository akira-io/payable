# Queue

Background work (primarily webhook processing) is dispatched through the `QueueDriver` contract. The
engine ships two implementations: a synchronous in-process driver and a Redis-backed BullMQ driver.

## The `QueueDriver` contract

Source: `src/domain/contracts/queue-driver.contract.ts`.

```ts
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
```

- `dispatch(job)` - enqueues a job. A job carries its `name`, a `payload`, a `correlationId`, and an
  optional `idempotencyKey`.
- `process(name, handler)` - registers a handler for jobs of a given `name`.

## How webhook jobs are dispatched

The engine registers exactly one handler at construction time. In `Payable`'s constructor
(`src/payable.ts`):

```ts
this.resolved.queue.process(PROCESS_WEBHOOK_JOB, (job: QueueJob) =>
  this.processWebhookJob(job),
);
```

`PROCESS_WEBHOOK_JOB` is the constant `'webhook.process'` defined in
`src/application/actions/webhooks/process-webhook.action.ts`. When a webhook is received, the receive
action persists the event and dispatches a `webhook.process` job whose payload is a
`ProcessWebhookJobPayload` (`providerName`, `webhookEventId`, `providerEventId`, `correlationId`,
`tenantId`). The registered handler resolves the per-provider webhook dependencies and runs
`ProcessWebhookAction`, which loads the stored event and feeds it through the process pipeline. The same
contract is used regardless of which driver is configured, so swapping sync for BullMQ does not change
the dispatch site.

## `SyncQueueDriver` (default)

Source: `src/infrastructure/queue/sync/sync-queue-driver.ts`.

```ts
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
```

- Runs the handler **inline** on `dispatch`, in the same process and tick. There is no Redis, no worker,
  no retry.
- If no handler is registered for the job name, `dispatch` is a silent no-op.
- Behavior: the caller awaits the full job. A throw in the handler propagates back to the dispatcher.
- Use when: tests, single-process deployments, or any setup where webhook processing can run
  synchronously within the request that received it.

## `BullMQQueueDriver` (async, Redis-backed)

Source: `src/infrastructure/queue/bullmq/bullmq-queue-driver.ts`. BullMQ is an optional peer
(`bullmq >=5`; `bullmq@^5.79.1` in devDependencies) loaded lazily via dynamic `import('bullmq')`, so it
is only required when this driver is actually used.

### Options

```ts
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
```

| Option | Default | Effect |
| --- | --- | --- |
| `connection` | required | Redis connection options passed to BullMQ `Queue` and `Worker`. |
| `prefix` | none | BullMQ key prefix for queues and workers. |
| `attempts` | `5` | Retry attempts per job (see `retryOptions`). |
| `backoffMs` | `1000` | Base delay for the exponential backoff. |
| `removeOnFailCount` | `1000` | How many failed jobs to retain (`removeOnFail.count`). |
| `removeOnCompleteAgeSec` | `86400` (1 day) | Age in seconds after which completed jobs are removed (`removeOnComplete.age`). |
| `deadLetterSuffix` | `':dead'` | Suffix appended to the queue name when routing exhausted jobs to the dead-letter queue. |
| `deadLetterAttempts` | `3` | Write attempts when moving an exhausted job to the dead-letter queue (minimum `1`). |
| `onFailed` | none | Callback invoked on a worker `failed` event with `(jobName, error)`. |
| `onError` | none | Callback invoked on a worker `error` event, and on background dispatch / dead-letter failures, with `(name, error)`. Distinct from `onFailed`. |

### Retry and retention

```ts
export interface BullMQRetryOptions {
  attempts: number;
  backoff: { type: 'exponential'; delay: number };
}
```

`retryOptions()` returns `{ attempts: options.attempts ?? 5, backoff: { type: 'exponential', delay: options.backoffMs ?? 1000 } }`.
`jobOptions(jobId?)` merges those retry options with retention settings:

```ts
{
  jobId,
  removeOnComplete: { age: this.options.removeOnCompleteAgeSec ?? 86_400 },
  removeOnFail: { count: this.options.removeOnFailCount ?? 1000 },
  ...this.retryOptions(),
}
```

- **Completed jobs are removed by age** (`removeOnComplete.age`, default `86400` seconds = 1 day).
- **Failed jobs are retained up to `removeOnFailCount`** (default `1000`) so they can be inspected and
  retried.
- The job's `idempotencyKey` is passed as the BullMQ `jobId`, giving dispatch-level deduplication: two
  jobs with the same id are not enqueued twice.

### Dispatch and worker lifecycle

- `dispatch(job)` lazily creates (and caches) a `Queue` for the job name, then `queue.add(name, { payload, correlationId }, jobOptions(idempotencyKey))`.
- `process(name, handler)` starts a `Worker` (once per name; cached in a `Map`). The worker rehydrates a
  `QueueJob` from `job.data` (`payload`, `correlationId`) and `job.opts.jobId` (`idempotencyKey`) before
  calling the handler.
- A worker `failed` event invokes `options.onFailed?.(job?.name ?? name, error)`. When the job has
  exhausted its attempts, it is also written to a dead-letter queue named
  `${name}${deadLetterSuffix ?? ':dead'}` (retried up to `deadLetterAttempts`, default `3`).
- A worker `error` event, and any background dispatch or dead-letter write failure, invokes
  `options.onError?.(name, error)`.

### Wiring example

```ts
import { createPayable } from '@akira-io/payable';
import { BullMQQueueDriver } from '@akira-io/payable';

const queue = new BullMQQueueDriver({
  connection: { host: '127.0.0.1', port: 6379 },
  prefix: 'payable',
  attempts: 5,
  backoffMs: 1000,
  removeOnFailCount: 1000,
  onFailed: (jobName, error) => logger.error('queue job failed', { jobName, error }),
});

const payable = createPayable({
  providers: { stripe },
  queue,
  // storage is required for webhook processing
});
```

The worker that drains `webhook.process` jobs is started when `Payable` calls
`queue.process(PROCESS_WEBHOOK_JOB, ...)` in its constructor, so simply constructing the engine with the
BullMQ driver registers the consumer.

## Choosing a driver

| Use `SyncQueueDriver` when | Use `BullMQQueueDriver` when |
| --- | --- |
| Tests or local development | Production with separate web and worker processes |
| Single-process deployments | You need retries, backoff, and failed-job inspection |
| Webhook handling can complete within the request | Webhook handling should be offloaded and durable |

## Edge cases

- **Sync driver, unregistered job name**: `dispatch` silently does nothing. Only `webhook.process` is
  registered by the engine.
- **Failed BullMQ jobs**: retained up to `removeOnFailCount` (default `1000`); older failures beyond that
  are evicted. Surface failures through `onFailed` to avoid losing visibility.
- **Duplicate dispatch**: with BullMQ, reusing the same `idempotencyKey` (`jobId`) prevents a second
  enqueue of the same logical job.

---

[Previous: Prisma Storage](21b-storage-prisma.md) · [Index](../00-index.md) · [Next: Express](../adapters/23-express.md)
