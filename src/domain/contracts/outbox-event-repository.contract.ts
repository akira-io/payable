export type OutboxStatus = 'pending' | 'processing' | 'published' | 'failed';

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
  readonly lockToken?: string | null;
  readonly dedupeKey?: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export type NewOutboxEvent = Omit<
  OutboxEvent,
  'id' | 'status' | 'attempts' | 'nextRetryAt' | 'lockToken' | 'createdAt' | 'updatedAt'
>;

export interface OutboxEventRepository {
  create(data: NewOutboxEvent): Promise<OutboxEvent>;
  claimPending(limit: number): Promise<OutboxEvent[]>;
  markPublished(id: string, lockToken?: string | null): Promise<number>;
  markFailed(id: string, nextRetryAt: Date | null, lockToken?: string | null): Promise<number>;
}
