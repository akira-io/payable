import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import type { SispClient } from '../src/infrastructure/providers/sisp/sisp-types';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

const OPTIONS: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  database: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
};

function fakeSispClient(seen: { body?: Record<string, unknown> }): SispClient {
  return {
    config: { generators: { merchantReference: () => 'R-CHECKOUT' } },
    handlers: {
      handlePayment: async (request) => {
        seen.body = request.body;
        return { type: 'html', status: 200, html: `<form>${request.body.merchantRef}</form>` };
      },
    },
    driver: () => ({ paymentEndpoint: () => 'https://mc.vinti4net.cv/gateway' }),
    models: { transactions: { findByRef: async () => null } },
    refund: () => {
      throw new Error('not used');
    },
    validateCallback: () => true,
    handlePaymentCallback: async (payload) => ({
      id: 1,
      merchant_ref: String(payload.merchantRef ?? 'R-CHECKOUT'),
      amount: 1500,
      currency: 'CVE',
      status: 'completed',
      transaction_id: 'TID-9',
    }),
  };
}

describe('payable redirect checkout (SISP)', () => {
  it('starts a payment, links a local customer, and reconciles the callback', async () => {
    const db = createTestDb();
    await migrate(db);
    const seen: { body?: Record<string, unknown> } = {};
    const payable = createPayable({
      providers: { sisp: new SispProvider(OPTIONS, fakeSispClient(seen)) },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });

    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(150000, 'CVE'))
      .create({ reference: 'order-1' });

    expect(session.id).toMatch(/^R[0-9A-F]{14}$/);
    expect(session.url).toBe('https://mc.vinti4net.cv/gateway');
    expect(session.html).toContain(session.id);
    expect(seen.body?.amount).toBe('1500.00');

    const customer = await payable.customers().get(billable);
    expect(customer?.providerCustomerId).toBeNull();
    expect(customer?.provider).toBe('sisp');

    const pending = await payable.customer(billable).payments();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      provider: 'sisp',
      providerPaymentId: session.id,
      status: 'pending',
      amount: 150000,
      customerId: customer?.id,
    });

    const result = await payable.receiveRedirectCallback({
      provider: 'sisp',
      payload: { merchantRef: session.id },
    });
    expect(result).toEqual({
      providerPaymentId: session.id,
      status: 'succeeded',
      paymentUpdated: true,
    });

    const settled = await payable.customer(billable).payments();
    expect(settled[0]?.status).toBe('succeeded');
    await db.destroy();
  });
});
