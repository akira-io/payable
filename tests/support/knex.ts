import { knex as createKnex, type Knex } from 'knex';
import type { NewCustomer } from '../../src/domain/contracts/customer-repository.contract';

export function createTestDb(): Knex {
  return createKnex({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
  });
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
