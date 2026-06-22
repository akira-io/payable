export type OutboxStatus = 'pending' | 'published' | 'failed';

export interface OutboxEvent {
  readonly id: string;
  readonly tenantId: string | null;
  readonly correlationId: string;
  readonly eventType: string;
  readonly eventVersion: number;
  readonly payload: Record<string, unknown>;
  readonly status: OutboxStatus;
  readonly attempts: number;
  readonly nextRetryAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type NewOutboxEvent = Omit<
  OutboxEvent,
  'id' | 'status' | 'attempts' | 'nextRetryAt' | 'createdAt' | 'updatedAt'
>;

export interface OutboxEventRepository {
  create(data: NewOutboxEvent): Promise<OutboxEvent>;
  pullPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string): Promise<void>;
  markFailed(id: string, nextRetryAt: Date | null): Promise<void>;
}
