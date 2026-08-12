import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { createPrismaHarness } from './support/prisma';
import type { StorageHarness } from './support/storage-contract';

let harness: StorageHarness;

beforeAll(async () => {
  harness = await createPrismaHarness();
}, 120_000);

afterAll(async () => {
  await harness.teardown();
});

describe('Prisma canonical reset', () => {
  it('removes invoice relations before their referenced payment and invoice', async () => {
    const tenantId = 'prisma-canonical-reset';
    const payable = createPayable({ storage: harness.storage, tenant: { enabled: true } });
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'User',
      billableId: 'reset-user',
      email: 'reset@example.com',
    });
    const payment = await payable.storedPayments(tenantId).record({
      customerId: customer.id,
      amount: Money.of(1000, 'EUR'),
      status: 'pending',
      collectionMethod: 'bank_transfer',
    });
    const invoice = await payable.canonicalInvoices(tenantId).create({
      customerId: customer.id,
      status: 'open',
      currency: 'EUR',
      total: 1000,
      amountPaid: 0,
      amountDue: 1000,
    });
    await payable.canonicalInvoices(tenantId).attachPayment(invoice.id, payment.id);
    await payable.canonicalInvoices(tenantId).attachProvider(invoice.id, {
      provider: 'stripe',
      providerResourceType: 'invoice',
      providerResourceId: 'in_reset',
    });

    await expect(harness.reset()).resolves.toBeUndefined();
    await expect(payable.storedPayments(tenantId).retrieve(payment.id)).rejects.toMatchObject({
      code: 'PAYMENT_NOT_FOUND',
    });
    await expect(payable.canonicalInvoices(tenantId).list()).resolves.toMatchObject({ items: [] });
  });
});
