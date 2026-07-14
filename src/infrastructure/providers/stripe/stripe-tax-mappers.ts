import type Stripe from 'stripe';
import type {
  CalculateTaxInput,
  TaxCalculationDTO,
  TaxTransactionDTO,
} from '../../../domain/dtos/tax.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount, stripeMoney } from './stripe-amounts';

type StripeCustomerDetails = NonNullable<Stripe.Tax.CalculationCreateParams['customer_details']>;
type StripeTaxId = NonNullable<StripeCustomerDetails['tax_ids']>[number];

export function stripeTaxCalculationParams(
  input: CalculateTaxInput,
): Stripe.Tax.CalculationCreateParams {
  const first = input.lineItems[0];
  if (!first) {
    throw new PayableError('Stripe Tax requires at least one line item', {
      code: 'PROVIDER_REQUEST_INVALID',
      context: { provider: 'stripe-tax' },
    });
  }
  const currency = first.amount.currency().toUpperCase();
  const monies = [
    ...input.lineItems.map((item) => item.amount),
    ...(input.shipping ? [input.shipping] : []),
  ];
  if (monies.some((money) => money.currency().toUpperCase() !== currency)) {
    throw new PayableError('Stripe Tax does not support mixed currencies in one calculation', {
      code: 'PROVIDER_TAX_CURRENCY_MISMATCH',
      context: { provider: 'stripe-tax', currency },
    });
  }
  return {
    currency: currency.toLowerCase(),
    customer_details: {
      address: {
        line1: input.customerAddress.line1,
        line2: input.customerAddress.line2,
        city: input.customerAddress.city,
        state: input.customerAddress.region,
        postal_code: input.customerAddress.postalCode,
        country: input.customerAddress.country,
      },
      address_source: 'shipping',
      tax_ids: input.customerTaxIds?.map(stripeTaxId),
    },
    line_items: input.lineItems.map((item) => ({
      reference: item.reference,
      amount: stripeAmount(item.amount),
      quantity: item.quantity,
      tax_code: item.taxCode,
    })),
    shipping_cost: input.shipping ? { amount: stripeAmount(input.shipping) } : undefined,
  };
}

export function mapStripeTaxCalculation(calculation: Stripe.Tax.Calculation): TaxCalculationDTO {
  if (!calculation.id) {
    throw new PayableError('Stripe Tax calculation response is missing an id', {
      code: 'PROVIDER_RESPONSE_INVALID',
      context: { provider: 'stripe-tax' },
    });
  }
  const taxAmount = calculation.tax_amount_exclusive + calculation.tax_amount_inclusive;
  return {
    providerCalculationId: calculation.id,
    status: 'complete',
    subtotal: stripeMoney(calculation.amount_total - taxAmount, calculation.currency),
    tax: stripeMoney(taxAmount, calculation.currency),
    total: stripeMoney(calculation.amount_total, calculation.currency),
    expiresAt: calculation.expires_at ? new Date(calculation.expires_at * 1000) : null,
  };
}

export function mapStripeTaxTransaction(transaction: Stripe.Tax.Transaction): TaxTransactionDTO {
  return {
    providerTransactionId: transaction.id,
    reference: transaction.reference,
    status: transaction.type === 'transaction' ? 'committed' : 'reversed',
    createdAt: new Date(transaction.created * 1000),
  };
}

function stripeTaxId(value: string): StripeTaxId {
  const separator = value.indexOf(':');
  if (separator < 1 || separator === value.length - 1) {
    throw new PayableError('Stripe Tax ids must use the type:value format', {
      code: 'PROVIDER_REQUEST_INVALID',
      context: { provider: 'stripe-tax' },
    });
  }
  return {
    type: value.slice(0, separator) as StripeTaxId['type'],
    value: value.slice(separator + 1),
  };
}
