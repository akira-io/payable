import { z } from 'zod';
import type { CacheDriver } from '../../domain/contracts/cache-driver.contract';
import type { Clock } from '../../domain/contracts/clock.contract';
import type { Encryption } from '../../domain/contracts/encryption.contract';
import type { EventBus } from '../../domain/contracts/event-bus.contract';
import type { IdempotencyKeyResolver } from '../../domain/contracts/idempotency-key-resolver.contract';
import type { IdempotencyStore } from '../../domain/contracts/idempotency-store.contract';
import type { LockDriver } from '../../domain/contracts/lock-driver.contract';
import type { Logger } from '../../domain/contracts/logger.contract';
import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import { InMemoryEventBus } from '../../infrastructure/event-bus/in-memory-event-bus';
import { SystemClock } from '../clock/system-clock';
import { NullLogger } from '../logger/null-logger';

export type IdempotencyStrategy = 'auto' | 'manual';

export interface IdempotencyConfig {
  enabled?: boolean;
  strategy?: IdempotencyStrategy;
  resolver?: IdempotencyKeyResolver;
  store?: IdempotencyStore;
}

export interface PayableConfig {
  tenant?: { enabled: boolean };
  providers: Record<string, PaymentProvider>;
  storage?: StorageDriver;
  queue?: QueueDriver;
  cache?: CacheDriver;
  locks?: LockDriver;
  clock?: Clock;
  logger?: Logger;
  events?: EventBus;
  encryption?: Encryption;
  idempotency?: IdempotencyConfig;
}

export interface ResolvedIdempotency {
  enabled: boolean;
  strategy: IdempotencyStrategy;
  resolver?: IdempotencyKeyResolver;
  store?: IdempotencyStore;
}

export interface ResolvedConfig {
  tenantEnabled: boolean;
  providers: Map<string, PaymentProvider>;
  storage?: StorageDriver;
  queue?: QueueDriver;
  cache?: CacheDriver;
  locks?: LockDriver;
  clock: Clock;
  logger: Logger;
  events: EventBus;
  encryption?: Encryption;
  idempotency: ResolvedIdempotency;
}

const schema = z.object({
  tenant: z.object({ enabled: z.boolean() }).optional(),
  idempotency: z
    .object({
      enabled: z.boolean().optional(),
      strategy: z.enum(['auto', 'manual']).optional(),
    })
    .optional(),
});

export function resolveConfig(config: PayableConfig): ResolvedConfig {
  schema.parse({ tenant: config.tenant, idempotency: config.idempotency });
  const entries = Object.entries(config.providers ?? {});
  if (entries.length === 0) {
    throw new TypeError('Payable requires at least one payment provider');
  }
  return {
    tenantEnabled: config.tenant?.enabled ?? false,
    providers: new Map(entries),
    storage: config.storage,
    queue: config.queue,
    cache: config.cache,
    locks: config.locks,
    clock: config.clock ?? new SystemClock(),
    logger: config.logger ?? new NullLogger(),
    events: config.events ?? new InMemoryEventBus(),
    encryption: config.encryption,
    idempotency: {
      enabled: config.idempotency?.enabled ?? true,
      strategy: config.idempotency?.strategy ?? 'auto',
      resolver: config.idempotency?.resolver,
      store: config.idempotency?.store,
    },
  };
}
