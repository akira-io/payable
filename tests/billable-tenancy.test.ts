import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { ChargeInput, ChargeResultDTO } from '../src/domain/dtos/charge.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { CreateCustomerInput } from '../src/domain/dtos/customer.dto';
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
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('billable tenant isolation', () => {
  it('requires a tenant id when tenancy is enabled', () => {
    const payable = createPayable({
      providers: { stripe: new UniqueProvider() },
      tenant: { enabled: true },
    });
    expect(() => payable.customer(billable)).toThrow('A tenant id is required');
  });

  it('keeps customers and payments scoped to their tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { stripe: new UniqueProvider() },
      storage,
      clock,
      tenant: { enabled: true },
    });

    await payable
      .customer(billable, undefined, 'tenant-a')
      .charge({ amount: Money.of(1000, 'USD') });
    await payable
      .customer(billable, undefined, 'tenant-b')
      .charge({ amount: Money.of(2000, 'USD') });

    const customerA = await storage.customers.findByBillable('User', '1', 'tenant-a');
    const customerB = await storage.customers.findByBillable('User', '1', 'tenant-b');
    expect(customerA?.tenantId).toBe('tenant-a');
    expect(customerB?.tenantId).toBe('tenant-b');
    expect(customerA?.id).not.toBe(customerB?.id);

    expect(await storage.customers.findByBillable('User', '1', null)).toBeNull();

    const paymentsA = await storage.payments.listByCustomer(customerA?.id ?? '');
    const paymentsB = await storage.payments.listByCustomer(customerB?.id ?? '');
    expect(paymentsA).toHaveLength(1);
    expect(paymentsB).toHaveLength(1);
    expect(paymentsA[0]?.amount).toBe(1000);
    expect(paymentsB[0]?.amount).toBe(2000);
    expect(paymentsA[0]?.tenantId).toBe('tenant-a');
    await db.destroy();
  });

  it('scopes findById and update by tenant id', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);

    const payment = await storage.payments.create({
      tenantId: 'tenant-a',
      customerId: null,
      provider: 'stripe',
      providerPaymentId: 'pi_1',
      status: 'succeeded',
      currency: 'USD',
      amount: 1000,
      refundedAmount: 0,
      reference: null,
      description: null,
    });

    expect(await storage.payments.findById(payment.id, 'tenant-a')).not.toBeNull();
    expect(await storage.payments.findById(payment.id, 'tenant-b')).toBeNull();
    expect(await storage.payments.findById(payment.id)).not.toBeNull();

    await expect(
      storage.payments.update(payment.id, { refundedAmount: 500 }, 'tenant-b'),
    ).rejects.toThrow();

    const updated = await storage.payments.update(payment.id, { refundedAmount: 500 }, 'tenant-a');
    expect(updated.refundedAmount).toBe(500);
    await db.destroy();
  });

  it('blocks cross-tenant webhook event lookup', async () => {
    const db = createTestDb();
    await migrate(db);
    const storage = new KnexStorageDriver(db);

    const event = await storage.webhookEvents.create({
      tenantId: 'tenant-a',
      provider: 'stripe',
      providerEventId: 'evt_1',
      type: 'payment_intent.succeeded',
      normalizedType: null,
      payload: '{}',
      data: {},
      headers: {},
      status: 'pending',
      correlationId: 'corr_1',
      receivedAt: new Date('2026-06-22T00:00:00.000Z'),
    });

    expect(await storage.webhookEvents.findById(event.id, 'tenant-a')).not.toBeNull();
    expect(await storage.webhookEvents.findById(event.id, 'tenant-b')).toBeNull();
    await db.destroy();
  });
});
