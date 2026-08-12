import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { generatePrismaClient } from './support/prisma-generate';

function taggedSchema(): string {
  for (const [command, args] of [
    ['git', ['show', 'v1.0.0-beta7:tests/prisma/schema.prisma']],
    ['jj', ['file', 'show', '-r', 'v1.0.0-beta7', 'tests/prisma/schema.prisma']],
  ] as const) {
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.status === 0) return result.stdout;
  }
  throw new Error('Unable to read the beta7 Prisma schema from the immutable release tag');
}

function pushSchema(schema: string, databaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    ['node_modules/prisma/build/index.js', 'db', 'push', '--skip-generate', '--schema', schema],
    { encoding: 'utf8', env: { ...process.env, PAYABLE_PRISMA_TEST_URL: databaseUrl } },
  );
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

describe('beta7 to beta8 package upgrade', () => {
  it('upgrades a tagged Prisma database through Knex and Prisma idempotently', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'payable-beta-upgrade-'));
    const databasePath = join(fixture, 'payable.sqlite');
    const databaseUrl = `file:${databasePath}`;
    const beta7Schema = join(fixture, 'beta7.prisma');
    writeFileSync(databasePath, '');
    writeFileSync(beta7Schema, taggedSchema());
    pushSchema(beta7Schema, databaseUrl);

    const database = knex({
      client: 'better-sqlite3',
      connection: { filename: databasePath },
      useNullAsDefault: true,
    });
    const timestamp = '2026-08-08T00:00:00.000Z';
    await database('payable_canonical_products').insert({
      id: 'product-a',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      name: 'Product',
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database('payable_canonical_prices').insert({
      id: 'price-a',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      product_id: 'product-a',
      currency: 'EUR',
      unit_amount: 1000,
      type: 'recurring',
      interval: 'month',
      interval_count: 1,
      active: true,
      created_at: timestamp,
      updated_at: timestamp,
    });
    await database('payable_subscriptions').insert({
      id: 'subscription-a',
      tenant_id: 'tenant-a',
      tenant_key: 'tenant-a',
      customer_id: 'customer-a',
      name: 'default',
      status: 'active',
      quantity: 1,
      canonical_price_id: 'price-a',
      created_at: timestamp,
      updated_at: timestamp,
    });

    await migrate(database);
    await migrate(database);
    expect(
      await database('payable_subscriptions').where({ id: 'subscription-a' }).first(),
    ).toMatchObject({
      canonical_product_id: 'product-a',
      canonical_price_id: 'price-a',
      tenant_key: 'tenant-a',
    });
    await database.destroy();

    generatePrismaClient();
    process.env.PAYABLE_PRISMA_TEST_URL = databaseUrl;
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    await expect(
      prisma.payableSubscription.findUnique({ where: { id: 'subscription-a' } }),
    ).resolves.toMatchObject({ canonicalProductId: 'product-a', canonicalPriceId: 'price-a' });
    await expect(
      prisma.payableSubscription.findUnique({ where: { id: 'subscription-a' } }),
    ).resolves.toMatchObject({ canonicalProductId: 'product-a', canonicalPriceId: 'price-a' });
    await prisma.$disconnect();
  }, 30_000);
});
