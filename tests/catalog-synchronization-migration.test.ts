import { describe, expect, it } from 'vitest';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { createTestDb } from './support/knex';

describe('catalog synchronization migration', () => {
  it('creates tenant and provider scoped synchronization state', async () => {
    const database = createTestDb();
    await migrate(database);

    await expect(database.schema.hasTable('payable_catalog_synchronizations')).resolves.toBe(true);
    const indexes = (await database.raw(
      "select name from sqlite_master where type = 'index' and tbl_name = ?",
      ['payable_catalog_synchronizations'],
    )) as Array<{ name: string }>;
    expect(indexes.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        'payable_catalog_sync_resource_unique',
        'payable_catalog_sync_tenant_id_unique',
        'payable_catalog_sync_status_index',
      ]),
    );

    await database.destroy();
  });
});
