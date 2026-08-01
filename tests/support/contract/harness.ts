import type { IdempotencyStore } from '../../../src/domain/contracts/idempotency-store.contract';
import type { StorageDriver } from '../../../src/domain/contracts/storage-driver.contract';
import type { FakeClock } from '../../../src/support/clock/fake-clock';

export interface StorageHarness {
  storage: StorageDriver;
  idempotency: IdempotencyStore;
  clock: FakeClock;
  readCatalogRow(kind: 'product' | 'price', id: string): Promise<CatalogRowSnapshot | null>;
  setRawPriceCurrency(id: string, currency: string): Promise<void>;
  reset(): Promise<void>;
  teardown(): Promise<void>;
}

export interface CatalogRowSnapshot {
  tenantId: string | null;
  tenantKey: string;
  name?: string;
  active: boolean;
}

export interface ContractContext {
  harness(): StorageHarness;
}

export const CONTRACT_BASE_TIME = new Date('2026-06-22T00:00:00.000Z');
