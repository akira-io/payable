import type { Knex } from 'knex';
import { describe, expect, it } from 'vitest';
import { withMigrationLock } from '../src/infrastructure/storage/knex/migrations/migrate';

interface RecordedRaw {
  sql: string;
  connection: unknown;
}

function fakeLockingKnex(dialect: string, lockValue: number | null) {
  const calls: RecordedRaw[] = [];
  let acquired = 0;
  let released = 0;
  const connections: unknown[] = [];
  const knex = {
    client: {
      dialect,
      acquireConnection: async () => {
        acquired += 1;
        const connection = { id: acquired };
        connections.push(connection);
        return connection;
      },
      releaseConnection: async (_connection: unknown) => {
        released += 1;
      },
    },
    raw: (sql: string) => ({
      connection: (boundConnection: unknown) => {
        calls.push({ sql, connection: boundConnection });
        if (sql.includes('GET_LOCK')) {
          return Promise.resolve([[{ acquired: lockValue }]]);
        }
        return Promise.resolve([[]]);
      },
    }),
  };
  return {
    knex: knex as unknown as Knex,
    calls,
    connections,
    counters: {
      get acquired() {
        return acquired;
      },
      get released() {
        return released;
      },
    },
  };
}

describe('withMigrationLock connection ownership', () => {
  it('runs the PostgreSQL acquire and release on one acquired connection', async () => {
    const { knex, calls, connections, counters } = fakeLockingKnex('postgresql', 1);
    let ran = 0;

    await withMigrationLock(knex, async () => {
      ran += 1;
    });

    expect(ran).toBe(1);
    expect(counters.acquired).toBe(1);
    expect(counters.released).toBe(1);
    expect(calls.map((call) => call.sql)).toEqual([
      'SELECT pg_advisory_lock(?)',
      'SELECT pg_advisory_unlock(?)',
    ]);
    expect(calls[0]?.connection).toBe(connections[0]);
    expect(calls[1]?.connection).toBe(connections[0]);
  });

  it('releases the PostgreSQL lock and the connection when migrations fail', async () => {
    const { knex, calls, counters } = fakeLockingKnex('postgresql', 1);

    await expect(
      withMigrationLock(knex, async () => {
        throw new Error('migration boom');
      }),
    ).rejects.toThrow('migration boom');

    expect(calls.some((call) => call.sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(counters.released).toBe(1);
  });

  it('runs the MySQL acquire and release on one acquired connection', async () => {
    const { knex, calls, connections, counters } = fakeLockingKnex('mysql', 1);
    let ran = 0;

    await withMigrationLock(knex, async () => {
      ran += 1;
    });

    expect(ran).toBe(1);
    expect(calls.map((call) => call.sql)).toEqual([
      'SELECT GET_LOCK(?, ?) AS acquired',
      'SELECT RELEASE_LOCK(?)',
    ]);
    expect(calls[0]?.connection).toBe(connections[0]);
    expect(calls[1]?.connection).toBe(connections[0]);
    expect(counters.acquired).toBe(1);
    expect(counters.released).toBe(1);
  });
});

describe('withMigrationLock (mysql advisory lock)', () => {
  it('throws and does not run migrations when GET_LOCK times out (0)', async () => {
    const { knex, calls, counters } = fakeLockingKnex('mysql', 0);
    let ran = 0;

    await expect(
      withMigrationLock(knex, async () => {
        ran += 1;
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_LOCK_UNAVAILABLE' });

    expect(ran).toBe(0);
    expect(calls.some((call) => call.sql.includes('RELEASE_LOCK'))).toBe(false);
    expect(counters.released).toBe(1);
  });

  it('throws when GET_LOCK errors (null)', async () => {
    const { knex, counters } = fakeLockingKnex('mysql', null);
    let ran = 0;

    await expect(
      withMigrationLock(knex, async () => {
        ran += 1;
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION_LOCK_UNAVAILABLE' });
    expect(ran).toBe(0);
    expect(counters.released).toBe(1);
  });
});
