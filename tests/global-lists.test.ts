import { describe, expect, it } from 'vitest';
import type { Billable } from '../src/application/builders/billable';
import type { BillingDependencies } from '../src/application/builders/billing-dependencies';
import { ListAllPaymentsQuery } from '../src/application/queries/payments/list-all-payments.query';
import { ListAllSubscriptionsQuery } from '../src/application/queries/subscriptions/list-all-subscriptions.query';
import { createPayable } from '../src/create-payable';
import type { ChargeInput, ChargeResultDTO } from '../src/domain/dtos/charge.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateCustomerInput } from '../src/domain/dtos/customer.dto';
import type { CreateSubscriptionInput, SubscriptionDTO } from '../src/domain/dtos/subscription.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class UniqueProvider extends FakeProvider {
  private sequence = 0;

  override async createCustomer(
    input: CreateCustomerInput,
    _ctx: OperationContext,
  ): Promise<{ providerCustomerId: string; email: string; name: string | null }> {
    this.sequence += 1;
    return {
      providerCustomerId: `cus_${this.sequence}`,
      email: input.email,
      name: input.name ?? null,
    };
  }

  override async charge(input: ChargeInput, _ctx: OperationContext): Promise<ChargeResultDTO> {
    this.sequence += 1;
    return { providerPaymentId: `pi_${this.sequence}`, status: 'succeeded', amount: input.amount };
  }

  override async createSubscription(_input: CreateSubscriptionInput): Promise<SubscriptionDTO> {
    this.sequence += 1;
    return {
      providerSubscriptionId: `sub_${this.sequence}`,
      status: 'active',
      currentPeriodEnd: new Date('2026-07-22T00:00:00.000Z'),
      trialEndsAt: null,
    };
  }
}

function billable(id: string): Billable {
  return { billableType: 'User', billableId: id, email: `${id}@test.dev` };
}

function deps(
  provider: FakeProvider,
  storage: KnexStorageDriver,
  clock: FakeClock,
  tenantId: string | null,
): BillingDependencies {
  return { provider, providerName: 'stripe', clock, storage, tenantId };
}

describe('global tenant-scoped lists', () => {
  it('lists subscriptions across customers within a tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new UniqueProvider();
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });
    await payable.customer(billable('user-1')).newSubscription('default').price('price_1').create();
    await payable.customer(billable('user-2')).newSubscription('default').price('price_1').create();

    const all = await new ListAllSubscriptionsQuery(deps(provider, storage, clock, null)).run();

    expect(all).toHaveLength(2);
    await db.destroy();
  });

  it('scopes global payment listing by tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const storage = new KnexStorageDriver(db, clock);
    const provider = new UniqueProvider();
    const payable = createPayable({
      providers: { stripe: provider },
      storage,
      clock,
      tenant: { enabled: true },
    });
    await payable
      .customer(billable('a'), undefined, 'tenant-a')
      .charge({ amount: Money.of(500, 'USD') });
    await payable
      .customer(billable('b'), undefined, 'tenant-b')
      .charge({ amount: Money.of(700, 'USD') });

    const ownTenant = await new ListAllPaymentsQuery(
      deps(provider, storage, clock, 'tenant-a'),
    ).run();
    const otherTenant = await new ListAllPaymentsQuery(
      deps(provider, storage, clock, 'tenant-b'),
    ).run();

    expect(ownTenant).toHaveLength(1);
    expect(otherTenant).toHaveLength(1);
    expect(ownTenant[0]?.amount).toBe(500);
    await db.destroy();
  });

  it('returns an empty list when storage is absent', async () => {
    const clock = new FakeClock();
    const provider = new UniqueProvider();
    const query = new ListAllSubscriptionsQuery({
      provider,
      providerName: 'stripe',
      clock,
      tenantId: null,
    });

    expect(await query.run()).toEqual([]);
  });
});
