import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import {
  isTaxCalculationCapable,
  isTaxTransactionCapable,
} from '../src/domain/contracts/tax-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { StripeTaxProvider } from '../src/infrastructure/providers/stripe/stripe-tax-provider';

const context = { correlationId: 'corr-1', idempotencyKey: 'tax-idem-1' };

function calculation(overrides: Partial<Stripe.Tax.Calculation> = {}): Stripe.Tax.Calculation {
  return {
    id: 'taxcalc_1',
    object: 'tax.calculation',
    amount_total: 12_150,
    currency: 'usd',
    expires_at: 1_800_000_000,
    tax_amount_exclusive: 1150,
    tax_amount_inclusive: 0,
    ...overrides,
  } as Stripe.Tax.Calculation;
}

function transaction(type: Stripe.Tax.Transaction.Type = 'transaction'): Stripe.Tax.Transaction {
  return {
    id: type === 'transaction' ? 'tax_1' : 'taxr_1',
    object: 'tax.transaction',
    created: 1_725_000_000,
    currency: 'usd',
    reference: type === 'transaction' ? 'order-1' : 'refund-1',
    type,
  } as Stripe.Tax.Transaction;
}

function fakeStripe() {
  const create = vi.fn().mockResolvedValue(calculation());
  const retrieve = vi.fn().mockResolvedValue(calculation());
  const createFromCalculation = vi.fn().mockResolvedValue(transaction());
  const createReversal = vi.fn().mockResolvedValue(transaction('reversal'));
  const client = {
    tax: {
      calculations: { create, retrieve },
      transactions: { createFromCalculation, createReversal },
    },
  } as unknown as Stripe;
  return { client, create, retrieve, createFromCalculation, createReversal };
}

const provider = (client: Stripe) => new StripeTaxProvider({ secretKey: 'sk_test' }, client);

describe('Stripe Tax provider', () => {
  it('advertises both complete Tax capabilities without exposing secrets', () => {
    const { client } = fakeStripe();
    const instance = provider(client);

    expect(instance.capabilities()).toEqual(new Set(['calculations', 'transactions']));
    expect(isTaxCalculationCapable(instance)).toBe(true);
    expect(isTaxTransactionCapable(instance)).toBe(true);
    const configured = new StripeTaxProvider({ secretKey: 'sk_live_private' });
    expect(JSON.stringify(configured)).not.toContain('sk_live_private');
    expect(inspect(configured)).not.toContain('sk_live_private');
  });

  it('forwards line items, address, shipping, tax ids, and idempotency', async () => {
    const { client, create } = fakeStripe();

    const mapped = await provider(client).calculateTax(
      {
        customerAddress: {
          line1: '1 Main Street',
          line2: 'Suite 2',
          city: 'New York',
          region: 'NY',
          postalCode: '10001',
          country: 'US',
        },
        lineItems: [
          { reference: 'line-1', amount: Money.of(10_000, 'USD'), quantity: 2 },
          {
            reference: 'line-2',
            amount: Money.of(1000, 'USD'),
            quantity: 1,
            taxCode: 'txcd_10000000',
          },
        ],
        shipping: Money.of(250, 'USD'),
        customerTaxIds: ['eu_vat:DE123456789'],
      },
      context,
    );

    expect(create).toHaveBeenCalledWith(
      {
        currency: 'usd',
        customer_details: {
          address: {
            line1: '1 Main Street',
            line2: 'Suite 2',
            city: 'New York',
            state: 'NY',
            postal_code: '10001',
            country: 'US',
          },
          address_source: 'shipping',
          tax_ids: [{ type: 'eu_vat', value: 'DE123456789' }],
        },
        line_items: [
          { reference: 'line-1', amount: 10_000, quantity: 2, tax_code: undefined },
          { reference: 'line-2', amount: 1000, quantity: 1, tax_code: 'txcd_10000000' },
        ],
        shipping_cost: { amount: 250 },
      },
      { idempotencyKey: 'tax-idem-1' },
    );
    expect(mapped).toMatchObject({
      providerCalculationId: 'taxcalc_1',
      status: 'complete',
    });
    expect(mapped.subtotal.amount()).toBe(11_000);
    expect(mapped.tax.amount()).toBe(1150);
    expect(mapped.total.amount()).toBe(12_150);
  });

  it('retrieves a calculation without line-item pagination', async () => {
    const { client, retrieve } = fakeStripe();

    const result = await provider(client).retrieveTaxCalculation('taxcalc_1');

    expect(retrieve).toHaveBeenCalledWith('taxcalc_1');
    expect(result.expiresAt).toEqual(new Date(1_800_000_000_000));
  });

  it('rejects mixed line-item and shipping currencies before Stripe is called', async () => {
    const { client, create } = fakeStripe();

    await expect(
      provider(client).calculateTax(
        {
          customerAddress: {
            line1: '1 Main Street',
            city: 'New York',
            postalCode: '10001',
            country: 'US',
          },
          lineItems: [
            { reference: 'usd', amount: Money.of(1000, 'USD'), quantity: 1 },
            { reference: 'eur', amount: Money.of(1000, 'EUR'), quantity: 1 },
          ],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_TAX_CURRENCY_MISMATCH' });
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects an untyped customer tax id before Stripe is called', async () => {
    const { client, create } = fakeStripe();

    await expect(
      provider(client).calculateTax(
        {
          customerAddress: {
            line1: '1 Main Street',
            city: 'Berlin',
            postalCode: '10115',
            country: 'DE',
          },
          lineItems: [{ reference: 'line-1', amount: Money.of(1000, 'EUR'), quantity: 1 }],
          customerTaxIds: ['DE123456789'],
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(create).not.toHaveBeenCalled();
  });

  it('commits a calculation and forwards idempotency', async () => {
    const { client, createFromCalculation } = fakeStripe();

    const result = await provider(client).commitTaxTransaction(
      { providerCalculationId: 'taxcalc_1', reference: 'order-1' },
      context,
    );

    expect(createFromCalculation).toHaveBeenCalledWith(
      { calculation: 'taxcalc_1', reference: 'order-1' },
      { idempotencyKey: 'tax-idem-1' },
    );
    expect(result).toEqual({
      providerTransactionId: 'tax_1',
      reference: 'order-1',
      status: 'committed',
      createdAt: new Date(1_725_000_000_000),
    });
  });

  it('fully reverses a transaction and maps reversal state', async () => {
    const { client, createReversal } = fakeStripe();

    const result = await provider(client).reverseTaxTransaction(
      { providerTransactionId: 'tax_1', reference: 'refund-1' },
      context,
    );

    expect(createReversal).toHaveBeenCalledWith(
      { mode: 'full', original_transaction: 'tax_1', reference: 'refund-1' },
      { idempotencyKey: 'tax-idem-1' },
    );
    expect(result.status).toBe('reversed');
  });

  it('normalizes Stripe Tax errors', async () => {
    const { client, retrieve } = fakeStripe();
    retrieve.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      message: 'Tax calculation expired',
    });

    await expect(provider(client).retrieveTaxCalculation('expired')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
