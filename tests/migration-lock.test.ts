import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { withMigrationLock } from '../src/infrastructure/storage/knex/migrations/migrate';

function fakeMysql(lockValue: number | null) {
  const calls: string[] = [];
  const knex = {
    client: { dialect: 'mysql' },
    raw: async (sql: string) => {
      calls.push(sql);
      if (sql.includes('GET_LOCK')) {
        return [[{ acquired: lockValue }]];
      }
      return [[]];
    },
  };
  return { knex: knex as unknown as Knex, calls };
}

describe('withMigrationLock (mysql advisory lock)', () => {
  it('runs migrations and releases the lock when GET_LOCK returns 1', async () => {
    const { knex, calls } = fakeMysql(1);
    let ran = 0;

    await withMigrationLock(knex, async () => {
      ran += 1;
    });

    expect(ran).toBe(1);
    expect(calls.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(true);
  });

  it('throws and does not run migrations when GET_LOCK times out (0)', async () => {
    const { knex, calls } = fakeMysql(0);
    let ran = 0;

    await expect(
      withMigrationLock(knex, async () => {
        ran += 1;
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_LOCK_UNAVAILABLE' });

    expect(ran).toBe(0);
    expect(calls.some((sql) => sql.includes('RELEASE_LOCK'))).toBe(false);
  });

  it('throws when GET_LOCK errors (null)', async () => {
    const { knex } = fakeMysql(null);
    let ran = 0;

    await expect(
      withMigrationLock(knex, async () => {
        ran += 1;
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_LOCK_UNAVAILABLE' });
    expect(ran).toBe(0);
  });
});
