export type IdempotencyStatus = 'processing' | 'completed' | 'failed' | 'expired';

export interface IdempotencyRecord {
  readonly key: string;
  readonly scope: string;
  readonly operation: string;
  readonly resourceType: string | null;
  readonly resourceId: string | null;
  readonly requestHash: string;
  readonly response: unknown | null;
  readonly status: IdempotencyStatus;
  readonly lockedUntil: Date | null;
  readonly expiresAt: Date | null;
}

export interface IdempotencyStore {
  find(key: string, tenantId?: string | null): Promise<IdempotencyRecord | null>;
  put(record: IdempotencyRecord, tenantId?: string | null): Promise<void>;
  markCompleted(key: string, response: unknown, tenantId?: string | null): Promise<void>;
  markFailed(key: string, tenantId?: string | null): Promise<void>;
}
