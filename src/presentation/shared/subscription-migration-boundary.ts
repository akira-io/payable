import { PayableError } from '../../domain/errors/payable-error';

export interface SubscriptionPriceMigrationLimits {
  bodyLimit?: number;
  rateLimit?: {
    max: number;
    windowMs: number;
  };
}

export const DEFAULT_SUBSCRIPTION_PRICE_MIGRATION_LIMITS = {
  bodyLimit: 64 * 1024,
  rateLimit: { max: 100, windowMs: 60_000 },
} as const;

interface RateWindow {
  count: number;
  resetsAt: number;
}

export class SubscriptionMigrationMutationBoundary {
  private readonly windows = new Map<string, RateWindow>();
  private readonly bodyLimit: number;
  private readonly max: number;
  private readonly windowMs: number;

  constructor(limits: SubscriptionPriceMigrationLimits = {}) {
    this.bodyLimit = positiveInteger(
      limits.bodyLimit,
      DEFAULT_SUBSCRIPTION_PRICE_MIGRATION_LIMITS.bodyLimit,
    );
    this.max = positiveInteger(
      limits.rateLimit?.max,
      DEFAULT_SUBSCRIPTION_PRICE_MIGRATION_LIMITS.rateLimit.max,
    );
    this.windowMs = positiveInteger(
      limits.rateLimit?.windowMs,
      DEFAULT_SUBSCRIPTION_PRICE_MIGRATION_LIMITS.rateLimit.windowMs,
    );
  }

  get maxBodyBytes(): number {
    return this.bodyLimit;
  }

  enforceRate(input: { tenantId: string | null; actorId?: string }): void {
    this.consume(`${input.tenantId ?? 'missing'}:${input.actorId ?? 'anonymous'}`);
  }

  private consume(key: string): void {
    const now = Date.now();
    const current = this.windows.get(key);
    if (!current || current.resetsAt <= now) {
      this.windows.set(key, { count: 1, resetsAt: now + this.windowMs });
      this.prune(now);
      return;
    }
    if (current.count >= this.max) {
      throw new PayableError('Too many mutation requests', { code: 'RATE_LIMIT_EXCEEDED' });
    }
    current.count += 1;
  }

  private prune(now: number): void {
    if (this.windows.size <= 1_024) return;
    for (const [key, window] of this.windows) {
      if (window.resetsAt <= now) this.windows.delete(key);
    }
  }
}

export function subscriptionMigrationBodyLimit(limits: SubscriptionPriceMigrationLimits = {}) {
  return positiveInteger(limits.bodyLimit, DEFAULT_SUBSCRIPTION_PRICE_MIGRATION_LIMITS.bodyLimit);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && (value as number) > 0 ? (value as number) : fallback;
}
