import type { Clock } from '../../domain/contracts/clock.contract';
import type {
  OutboxEvent,
  OutboxEventRepository,
} from '../../domain/contracts/outbox-event-repository.contract';

export type OutboxDelivery = (event: OutboxEvent) => Promise<void>;

export interface OutboxServiceOptions {
  maxAttempts?: number;
  backoffMs?: number;
}

export interface OutboxPublishResult {
  published: number;
  retried: number;
  deadLettered: number;
}

export class OutboxService {
  private readonly maxAttempts: number;
  private readonly backoffMs: number;

  constructor(
    private readonly repository: OutboxEventRepository,
    private readonly clock: Clock,
    options: OutboxServiceOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffMs = options.backoffMs ?? 1000;
  }

  async publishPending(deliver: OutboxDelivery, limit = 50): Promise<OutboxPublishResult> {
    const events = await this.repository.claimPending(limit);
    const result: OutboxPublishResult = { published: 0, retried: 0, deadLettered: 0 };
    for (const event of events) {
      await this.publishOne(event, deliver, result);
    }
    return result;
  }

  private async publishOne(
    event: OutboxEvent,
    deliver: OutboxDelivery,
    result: OutboxPublishResult,
  ): Promise<void> {
    try {
      await deliver(event);
      await this.repository.markPublished(event.id);
      result.published += 1;
    } catch {
      const attempts = event.attempts + 1;
      if (attempts >= this.maxAttempts) {
        await this.repository.markFailed(event.id, null);
        result.deadLettered += 1;
        return;
      }
      await this.repository.markFailed(event.id, this.nextRetry(attempts));
      result.retried += 1;
    }
  }

  private nextRetry(attempts: number): Date {
    return new Date(this.clock.now().getTime() + this.backoffMs * 2 ** (attempts - 1));
  }
}
