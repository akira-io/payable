import { z } from 'zod';
import type { AccountingProvider } from '../../domain/contracts/accounting-provider.contract';
import type { CacheDriver } from '../../domain/contracts/cache-driver.contract';
import type { Clock } from '../../domain/contracts/clock.contract';
import type { Encryption } from '../../domain/contracts/encryption.contract';
import type { EventBus } from '../../domain/contracts/event-bus.contract';
import type { IdempotencyStore } from '../../domain/contracts/idempotency-store.contract';
import type { IdentityProvider } from '../../domain/contracts/identity-provider.contract';
import type { IssuingProvider } from '../../domain/contracts/issuing-provider.contract';
import type { LockDriver } from '../../domain/contracts/lock-driver.contract';
import type { Logger } from '../../domain/contracts/logger.contract';
import type { MarketplaceProvider } from '../../domain/contracts/marketplace-provider.contract';
import type { PaymentProvider } from '../../domain/contracts/payment-provider.contract';
import type { QueueDriver } from '../../domain/contracts/queue-driver.contract';
import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { TaxProvider } from '../../domain/contracts/tax-provider.contract';
import type { TenantResolver } from '../../domain/contracts/tenant-resolver.contract';
import type { TerminalProvider } from '../../domain/contracts/terminal-provider.contract';
import type { TreasuryProvider } from '../../domain/contracts/treasury-provider.contract';
import { InMemoryEventBus } from '../../infrastructure/event-bus/in-memory-event-bus';
import { SyncQueueDriver } from '../../infrastructure/queue/sync/sync-queue-driver';
import { SystemClock } from '../clock/system-clock';
import { NullLogger } from '../logger/null-logger';

export type IdempotencyStrategy = 'auto' | 'manual';

export interface IdempotencyConfig {
  enabled?: boolean;
  strategy?: IdempotencyStrategy;
  store?: IdempotencyStore;
}

export interface TenantConfig {
  enabled: boolean;
  resolver?: TenantResolver;
}

export interface AuthorizationConfig {
  enabled: boolean;
}

export interface PayableConfig {
  tenant?: TenantConfig;
  authorization?: AuthorizationConfig;
  providers: Record<string, PaymentProvider>;
  accountingProviders?: Record<string, AccountingProvider>;
  identityProviders?: Record<string, IdentityProvider>;
  issuingProviders?: Record<string, IssuingProvider>;
  marketplaceProviders?: Record<string, MarketplaceProvider>;
  taxProviders?: Record<string, TaxProvider>;
  terminalProviders?: Record<string, TerminalProvider>;
  treasuryProviders?: Record<string, TreasuryProvider>;
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
  store?: IdempotencyStore;
}

export interface ResolvedConfig {
  tenantEnabled: boolean;
  tenantResolver?: TenantResolver;
  authorizationEnabled: boolean;
  providers: Map<string, PaymentProvider>;
  accountingProviders: Map<string, AccountingProvider>;
  identityProviders: Map<string, IdentityProvider>;
  issuingProviders: Map<string, IssuingProvider>;
  marketplaceProviders: Map<string, MarketplaceProvider>;
  taxProviders: Map<string, TaxProvider>;
  terminalProviders: Map<string, TerminalProvider>;
  treasuryProviders: Map<string, TreasuryProvider>;
  storage?: StorageDriver;
  cache?: CacheDriver;
  locks?: LockDriver;
  queue: QueueDriver;
  clock: Clock;
  logger: Logger;
  events: EventBus;
  encryption?: Encryption;
  idempotency: ResolvedIdempotency;
}

const schema = z.object({
  tenant: z.object({ enabled: z.boolean() }).optional(),
  authorization: z.object({ enabled: z.boolean() }).optional(),
  idempotency: z
    .object({
      enabled: z.boolean().optional(),
      strategy: z.enum(['auto', 'manual']).optional(),
    })
    .optional(),
});

export function resolveConfig(config: PayableConfig): ResolvedConfig {
  schema.parse({
    tenant: config.tenant,
    authorization: config.authorization,
    idempotency: config.idempotency,
  });
  const entries = Object.entries(config.providers ?? {});
  if (entries.length === 0) {
    throw new TypeError('Payable requires at least one payment provider');
  }
  const logger = config.logger ?? new NullLogger();
  const idempotency: ResolvedIdempotency = {
    enabled: config.idempotency?.enabled ?? true,
    strategy: config.idempotency?.strategy ?? 'auto',
    store: config.idempotency?.store,
  };
  if (idempotency.enabled && idempotency.strategy !== 'manual' && !idempotency.store) {
    logger.warn(
      'Idempotency is enabled but no idempotency store is configured; charges and other operations will run without idempotency protection',
    );
  }
  return {
    tenantEnabled: config.tenant?.enabled ?? false,
    tenantResolver: config.tenant?.resolver,
    authorizationEnabled: config.authorization?.enabled ?? false,
    providers: new Map(entries),
    accountingProviders: new Map(Object.entries(config.accountingProviders ?? {})),
    identityProviders: new Map(Object.entries(config.identityProviders ?? {})),
    issuingProviders: new Map(Object.entries(config.issuingProviders ?? {})),
    marketplaceProviders: new Map(Object.entries(config.marketplaceProviders ?? {})),
    taxProviders: new Map(Object.entries(config.taxProviders ?? {})),
    terminalProviders: new Map(Object.entries(config.terminalProviders ?? {})),
    treasuryProviders: new Map(Object.entries(config.treasuryProviders ?? {})),
    storage: config.storage,
    cache: config.cache,
    locks: config.locks,
    queue: config.queue ?? new SyncQueueDriver(),
    clock: config.clock ?? new SystemClock(),
    logger,
    events: config.events ?? new InMemoryEventBus(),
    encryption: config.encryption,
    idempotency,
  };
}
