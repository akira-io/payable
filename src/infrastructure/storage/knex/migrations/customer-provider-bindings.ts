import type { Knex } from 'knex';
import { ensureCustomerBillableUnique } from './alter-existing-tables';
import { createCustomerProviderBindingsTable } from './billing-schema';

const CUSTOMERS = 'payable_customers';
const BINDINGS = 'payable_customer_provider_bindings';
const BACKFILL_BATCH_SIZE = 100;

interface LegacyCustomerProviderRow {
  id: string;
  provider: string;
  provider_customer_id: string;
  created_at: string | Date;
  updated_at: string | Date;
}

async function backfillCustomerProviderBindings(knex: Knex): Promise<void> {
  let lastCustomerId: string | undefined;
  while (true) {
    const query = knex(CUSTOMERS)
      .select('id', 'provider', 'provider_customer_id', 'created_at', 'updated_at')
      .whereNotNull('provider_customer_id')
      .orderBy('id', 'asc')
      .limit(BACKFILL_BATCH_SIZE);
    if (lastCustomerId) {
      query.where('id', '>', lastCustomerId);
    }
    const customers = (await query) as LegacyCustomerProviderRow[];
    if (customers.length === 0) {
      return;
    }
    await knex(BINDINGS)
      .insert(
        customers.map((customer) => ({
          id: globalThis.crypto.randomUUID(),
          customer_id: customer.id,
          provider: customer.provider,
          provider_customer_id: customer.provider_customer_id,
          created_at: customer.created_at,
          updated_at: customer.updated_at,
        })),
      )
      .onConflict(['customer_id', 'provider'])
      .ignore();
    lastCustomerId = customers.at(-1)?.id;
  }
}

async function findCustomerMissingProviderIdBinding(
  knex: Knex,
): Promise<{ id: string } | undefined> {
  return knex(`${CUSTOMERS} as customer`)
    .leftJoin(`${BINDINGS} as binding`, function joinBinding() {
      this.on('binding.customer_id', '=', 'customer.id').andOn(
        'binding.provider_customer_id',
        '=',
        'customer.provider_customer_id',
      );
    })
    .whereNotNull('customer.provider_customer_id')
    .whereNull('binding.id')
    .first('customer.id');
}

export async function addCustomerProviderBindings(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable(CUSTOMERS))) {
    return;
  }
  await ensureCustomerBillableUnique(knex);
  await createCustomerProviderBindingsTable(knex);
  const hasProvider = await knex.schema.hasColumn(CUSTOMERS, 'provider');
  const hasProviderCustomerId = await knex.schema.hasColumn(CUSTOMERS, 'provider_customer_id');
  if (!hasProvider && !hasProviderCustomerId) {
    return;
  }
  if (hasProvider && !hasProviderCustomerId) {
    await knex.schema.alterTable(CUSTOMERS, (table) => {
      table.dropColumn('provider');
    });
    return;
  }
  if (!hasProvider && hasProviderCustomerId) {
    const missing = await findCustomerMissingProviderIdBinding(knex);
    if (missing) {
      throw new Error(
        `Cannot drop payable_customers.provider_customer_id before binding customer ${missing.id}`,
      );
    }
    await knex.schema.alterTable(CUSTOMERS, (table) => {
      table.dropColumn('provider_customer_id');
    });
    return;
  }

  await backfillCustomerProviderBindings(knex);

  const missing = await knex(`${CUSTOMERS} as customer`)
    .leftJoin(`${BINDINGS} as binding`, function joinBinding() {
      this.on('binding.customer_id', '=', 'customer.id')
        .andOn('binding.provider', '=', 'customer.provider')
        .andOn('binding.provider_customer_id', '=', 'customer.provider_customer_id');
    })
    .whereNotNull('customer.provider_customer_id')
    .whereNull('binding.id')
    .first('customer.id');
  if (missing) {
    throw new Error(`Failed to backfill provider customer binding for ${missing.id as string}`);
  }

  await knex.schema.alterTable(CUSTOMERS, (table) => {
    table.dropColumns('provider', 'provider_customer_id');
  });
}
