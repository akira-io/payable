import type { Knex } from 'knex';
import { createCustomerProviderSyncStatesTable } from './billing-schema';

export function addCustomerProviderSyncStates(knex: Knex): Promise<void> {
  return createCustomerProviderSyncStatesTable(knex);
}
