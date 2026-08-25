import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type PrismaClientLike,
  PrismaIdempotencyRepository,
  PrismaStorageDriver,
} from '../../src/infrastructure/storage/prisma';
import { FakeClock } from '../../src/support/clock/fake-clock';
import { generatePrismaClient } from './prisma-generate';
import { CONTRACT_BASE_TIME, type StorageHarness } from './storage-contract';

const SCHEMA = 'tests/prisma/schema.prisma';
const TRUNCATE_ORDER = [
  'payableSubscriptionMutationClaim',
  'payableSubscriptionPriceMigration',
  'payablePriceProviderBinding',
  'payableProductProviderBinding',
  'payableCanonicalPrice',
  'payableCanonicalProduct',
  'payableWebhookEndpointEvent',
  'payableWebhookDelivery',
  'payableWebhookEndpoint',
  'payableSubscriptionItem',
  'payableSubscriptionProviderBinding',
  'payableInvoicePayment',
  'payableInvoiceProviderBinding',
  'payableCanonicalInvoice',
  'payableRefund',
  'payableSubscription',
  'payablePayment',
  'payableInvoice',
  'payablePrice',
  'payableProduct',
  'payableCustomerProviderBinding',
  'payableCustomerProviderSyncState',
  'payableCustomer',
  'payableWebhookEvent',
  'payableIdempotencyKey',
  'payableAuditLog',
  'payableOutboxEvent',
  'payableMigrationReport',
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

let clientGenerated = false;

function ensurePrismaClientGenerated(): void {
  if (clientGenerated) {
    return;
  }
  generatePrismaClient(SCHEMA);
  clientGenerated = true;
}

export async function createPrismaTestClient(): Promise<PrismaClientLike> {
  const dir = mkdtempSync(join(tmpdir(), 'payable-prisma-'));
  const databasePath = join(dir, 'test.db');
  writeFileSync(databasePath, '');
  process.env.PAYABLE_PRISMA_TEST_URL = `file:${databasePath}`;
  ensurePrismaClientGenerated();
  execFileSync('npx', ['prisma', 'db', 'push', '--schema', SCHEMA, '--skip-generate'], {
    stdio: 'ignore',
    env: process.env,
  });

  const mod = (await import('@prisma/client')) as unknown as {
    PrismaClient: new () => PrismaClientLike;
  };
  return new mod.PrismaClient();
}

export async function disconnectPrisma(prisma: PrismaClientLike): Promise<void> {
  await (prisma as unknown as { $disconnect(): Promise<void> }).$disconnect();
}

export async function createPrismaHarness(): Promise<StorageHarness> {
  const prisma = await createPrismaTestClient();
  const clock = new FakeClock(CONTRACT_BASE_TIME);

  const harness: StorageHarness = {
    storage: new PrismaStorageDriver(prisma, clock),
    idempotency: new PrismaIdempotencyRepository(prisma, clock),
    clock,
    async readCatalogRow(kind, id) {
      const delegate = kind === 'product' ? prisma.payableProduct : prisma.payablePrice;
      const row = await delegate.findFirst({ where: { id } });
      return row
        ? {
            tenantId: row.tenantId ?? null,
            tenantKey: row.tenantKey,
            name: 'name' in row ? row.name : undefined,
            active: row.active,
          }
        : null;
    },
    async setRawPriceCurrency(id, currency) {
      await prisma.payablePrice.update({ where: { id }, data: { currency } });
    },
    async reset() {
      await truncate(prisma);
      clock.set(CONTRACT_BASE_TIME);
      harness.clock = clock;
    },
    async teardown() {
      await disconnectPrisma(prisma);
    },
  };
  return harness;
}
