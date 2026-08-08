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

  it('allocates customer provider sync attempts atomically and rejects stale completions', async () => {
    const { storage } = context.harness();
    const repository = storage.customerProviderSyncStates;
    if (!repository) {
      throw new Error('Customer provider sync state repository is unavailable');
    }
    const customerA = await createCustomer(context, { billableId: 'logical-sync-a' });
    const customerB = await createCustomer(context, {
      tenantId: TENANT_B,
      billableId: 'logical-sync-b',
    });
    const attemptedAt = new Date('2026-08-08T10:00:00.000Z');
    const attempts = await Promise.all([
      repository.beginAttempt({
        tenantId: TENANT_A,
        customerId: customerA.id,
        provider: 'stripe',
        lastAttemptedAt: attemptedAt,
      }),
      repository.beginAttempt({
        tenantId: TENANT_A,
        customerId: customerA.id,
        provider: 'stripe',
        lastAttemptedAt: attemptedAt,
      }),
    ]);
    expect(attempts.map(({ attempts: count }) => count).sort()).toEqual([1, 2]);
    const [stale, current] = attempts.sort((left, right) => left.attempts - right.attempts);
    await repository.completeAttempt(
      {
        tenantId: TENANT_A,
        customerId: customerA.id,
        provider: 'stripe',
        status: 'synchronized',
        providerCustomerId: 'cus_current',
        attempts: current?.attempts ?? 0,
        lastAttemptedAt: attemptedAt,
        synchronizedAt: attemptedAt,
        failureCode: null,
      },
      current?.attempts ?? 0,
    );
    await expect(
      repository.completeAttempt(
        {
          tenantId: TENANT_A,
          customerId: customerA.id,
          provider: 'stripe',
          status: 'failed',
          providerCustomerId: null,
          attempts: stale?.attempts ?? 0,
          lastAttemptedAt: attemptedAt,
          synchronizedAt: null,
          failureCode: 'ETIMEDOUT',
        },
        stale?.attempts ?? 0,
      ),
    ).resolves.toBeNull();
    const tenantBAttempt = await repository.beginAttempt({
      tenantId: TENANT_B,
      customerId: customerB.id,
      provider: 'stripe',
      lastAttemptedAt: attemptedAt,
    });
    await repository.completeAttempt(
      {
        ...tenantBAttempt,
        providerCustomerId: 'cus_tenant_b',
        status: 'synchronized',
        synchronizedAt: attemptedAt,
      },
      tenantBAttempt.attempts,
    );

    expect(
      await repository.findByCustomerAndProvider(customerA.id, 'stripe', TENANT_A),
    ).toMatchObject({
      status: 'synchronized',
      attempts: 2,
      providerCustomerId: 'cus_current',
    });
    expect(
      await repository.findByCustomerAndProvider(customerB.id, 'stripe', TENANT_B),
    ).toMatchObject({
      status: 'synchronized',
      providerCustomerId: 'cus_tenant_b',
      attempts: 1,
    });
    expect(await repository.findByCustomerAndProvider(customerA.id, 'stripe', TENANT_B)).toBeNull();
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
