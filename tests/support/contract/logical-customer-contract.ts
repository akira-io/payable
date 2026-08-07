import { expect, it } from 'vitest';
import type {
  CustomerListQuery,
  NewCustomer,
} from '../../../src/domain/contracts/customer-repository.contract';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

const TENANT_A = 'logical-customer-tenant-a';
const TENANT_B = 'logical-customer-tenant-b';

export function registerLogicalCustomerContract(context: ContractContext): void {
  function listCustomers(query: CustomerListQuery, tenantId: string | null = TENANT_A) {
    const repository = context.harness().storage.customers;
    if (!repository.list) {
      throw new Error('Customer repository list is unavailable');
    }
    return repository.list(query, tenantId);
  }

  it('lists logical customers with stable equal-timestamp keyset pagination', async () => {
    const { storage } = context.harness();
    const created = await Promise.all([
      createCustomer(context, { billableId: 'logical-one' }),
      createCustomer(context, { billableId: 'logical-two' }),
      createCustomer(context, { billableId: 'logical-three' }),
    ]);

    const first = await listCustomers({ limit: 2 });
    const last = first.items.at(-1);
    expect(last).toBeDefined();
    const second = await listCustomers({
      limit: 2,
      before: { createdAt: last?.createdAt ?? CONTRACT_BASE_TIME, id: last?.id ?? '' },
    });

    expect(first.hasMore).toBe(true);
    expect(second.hasMore).toBe(false);
    expect([...first.items, ...second.items].map(({ id }) => id).sort()).toEqual(
      created.map(({ id }) => id).sort(),
    );
    expect(storage.customers.list).toBeDefined();
  });

  it('applies exact identities, case-insensitive search, and tenant isolation', async () => {
    const ada = await createCustomer(context, {
      billableId: 'logical-ada',
      email: 'Ada.Lovelace@example.com',
      name: 'Ada Lovelace',
    });
    await createCustomer(context, { tenantId: TENANT_B, billableId: 'logical-ada' });

    await expect(
      listCustomers({ limit: 10, billableType: 'User', billableId: 'logical-ada' }),
    ).resolves.toMatchObject({ items: [ada] });
    expect((await listCustomers({ limit: 10, id: ada.id })).items).toEqual([ada]);
    expect((await listCustomers({ limit: 10, email: 'LOVELACE' })).items).toEqual([ada]);
    expect((await listCustomers({ limit: 10, name: 'love' })).items).toEqual([ada]);
    expect((await listCustomers({ limit: 10 }, TENANT_B)).items).toHaveLength(1);
  });

  it('lists bindings only for requested customers in the requested tenant', async () => {
    const { storage } = context.harness();
    const customerA = await createCustomer(context, { billableId: 'logical-binding-a' });
    const customerB = await createCustomer(context, {
      tenantId: TENANT_B,
      billableId: 'logical-binding-b',
    });
    await storage.customerProviderBindings.create({
      customerId: customerA.id,
      provider: 'stripe',
      providerCustomerId: 'cus_contract_a',
    });
    await storage.customerProviderBindings.create({
      customerId: customerB.id,
      provider: 'stripe',
      providerCustomerId: 'cus_contract_b',
    });
    const listBindings = storage.customerProviderBindings.listByCustomerIds;
    if (!listBindings) {
      throw new Error('Customer binding repository list is unavailable');
    }

    const bindings = await listBindings.call(
      storage.customerProviderBindings,
      [customerA.id, customerB.id],
      TENANT_A,
    );

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      customerId: customerA.id,
      providerCustomerId: 'cus_contract_a',
    });
  });
}

function createCustomer(context: ContractContext, overrides: Partial<NewCustomer>) {
  const { storage } = context.harness();
  return storage.customers.create({
    tenantId: TENANT_A,
    billableType: 'User',
    billableId: 'logical-customer',
    email: 'logical@example.com',
    name: null,
    metadata: null,
    ...overrides,
  });
}
