import type { Clock } from '../../domain/contracts/clock.contract';
import type { Logger } from '../../domain/contracts/logger.contract';
import type {
  OutboxEvent,
  OutboxEventRepository,
} from '../../domain/contracts/outbox-event-repository.contract';

export type OutboxDelivery = (event: OutboxEvent) => Promise<void>;

export interface OutboxServiceOptions {
  maxAttempts?: number;
  backoffMs?: number;
  maxBackoffMs?: number;
  logger?: Logger;
  random?: () => number;
}

export interface OutboxPublishResult {
  published: number;
  retried: number;
  deadLettered: number;
}

export class OutboxService {
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly logger?: Logger;
  private readonly random: () => number;

  constructor(
    private readonly repository: OutboxEventRepository,
    private readonly clock: Clock,
    options: OutboxServiceOptions = {},
  ) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.backoffMs = options.backoffMs ?? 1000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.logger = options.logger;
    this.random = options.random ?? Math.random;
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
    } catch (error) {
      await this.handleDeliveryFailure(event, error, result);
      return;
    }
    try {
      await this.repository.markPublished(event.id, event.lockToken);
      result.published += 1;
    } catch (error) {
      this.logger?.warn('Outbox event delivered but markPublished failed; will re-confirm later', {
        eventId: event.id,
        eventType: event.eventType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleDeliveryFailure(
    event: OutboxEvent,
    error: unknown,
    result: OutboxPublishResult,
  ): Promise<void> {
    const attempts = event.attempts + 1;
    const message = error instanceof Error ? error.message : String(error);
    if (attempts >= this.maxAttempts) {
      this.logger?.error('Outbox event dead-lettered', {
        eventId: event.id,
        eventType: event.eventType,
        attempts,
        error: message,
      });
      await this.repository.markFailed(event.id, null, event.lockToken);
      result.deadLettered += 1;
      return;
    }
    this.logger?.warn('Outbox delivery failed, scheduling retry', {
      eventId: event.id,
      eventType: event.eventType,
      attempts,
      error: message,
    });
    await this.repository.markFailed(event.id, this.nextRetry(attempts), event.lockToken);
    result.retried += 1;
  }

  private nextRetry(attempts: number): Date {
    const cap = Math.min(this.backoffMs * 2 ** (attempts - 1), this.maxBackoffMs);
    const half = cap / 2;
    const delay = Math.min(Math.floor(half + this.random() * half), this.maxBackoffMs);
    return new Date(this.clock.now().getTime() + delay);
  }
}
