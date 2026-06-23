import { knex as createKnex, type Knex } from 'knex';
import type { Clock } from '../../src/domain/contracts/clock.contract';
import type { NewCustomer } from '../../src/domain/contracts/customer-repository.contract';

export function createTestDb(): Knex {
  return createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: {
      min: 1,
      max: 1,
      afterCreate: (connection: { pragma: (statement: string) => void }, done: () => void) => {
        connection.pragma('foreign_keys = ON');
        done();
      },
    },
  });
}

export async function countDuePendingOutbox(db: Knex, clock: Clock): Promise<number> {
  const now = clock.now().toISOString();
  const rows = await db('payable_outbox_events')
    .where({ status: 'pending' })
    .where((builder) => builder.whereNull('next_retry_at').orWhere('next_retry_at', '<=', now));
  return rows.length;
}

export function makeCustomer(overrides: Partial<NewCustomer> = {}): NewCustomer {
  return {
    tenantId: null,
    provider: 'stripe',
    providerCustomerId: null,
    billableType: 'User',
    billableId: '1',
    email: 'user@example.com',
    name: null,
    metadata: null,
    ...overrides,
  };
}
