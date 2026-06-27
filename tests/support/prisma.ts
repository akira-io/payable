import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type PrismaClientLike,
  PrismaIdempotencyRepository,
  PrismaStorageDriver,
} from '../../src/infrastructure/storage/prisma';
import { FakeClock } from '../../src/support/clock/fake-clock';
import { CONTRACT_BASE_TIME, type StorageHarness } from './storage-contract';

const SCHEMA = 'tests/prisma/schema.prisma';

const TRUNCATE_ORDER = [
  'payableWebhookEndpointEvent',
  'payableWebhookDelivery',
  'payableWebhookEndpoint',
  'payableSubscriptionItem',
  'payableRefund',
  'payableSubscription',
  'payablePayment',
  'payableInvoice',
  'payablePrice',
  'payableProduct',
  'payableCustomer',
  'payableWebhookEvent',
  'payableIdempotencyKey',
  'payableAuditLog',
  'payableOutboxEvent',
];

interface Deletable {
  deleteMany(): Promise<unknown>;
}

async function truncate(client: PrismaClientLike): Promise<void> {
  const delegates = client as unknown as Record<string, Deletable>;
  for (const model of TRUNCATE_ORDER) {
    const delegate = delegates[model];
    if (delegate) {
      await delegate.deleteMany();
    }
  }
}

export async function createPrismaHarness(): Promise<StorageHarness> {
  const dir = mkdtempSync(join(tmpdir(), 'payable-prisma-'));
  process.env.PAYABLE_PRISMA_TEST_URL = `file:${join(dir, 'test.db')}`;
  execFileSync('npx', ['prisma', 'generate', '--schema', SCHEMA], { stdio: 'ignore' });
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', SCHEMA, '--skip-generate'], {
    stdio: 'ignore',
    env: process.env,
  });

  const mod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => PrismaClientLike;
  };
  const prisma = new mod.PrismaClient();
  const clock = new FakeClock(CONTRACT_BASE_TIME);

  const harness: StorageHarness = {
    storage: new PrismaStorageDriver(prisma, clock),
    idempotency: new PrismaIdempotencyRepository(prisma, clock),
    clock,
    async reset() {
      await truncate(prisma);
      clock.set(CONTRACT_BASE_TIME);
      harness.clock = clock;
    },
    async teardown() {
      await (prisma as unknown as { $disconnect(): Promise<void> }).$disconnect();
    },
  };
  return harness;
}
