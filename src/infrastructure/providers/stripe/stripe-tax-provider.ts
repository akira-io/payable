import type Stripe from 'stripe';
import type {
  TaxCalculationCapable,
  TaxProvider,
  TaxTransactionCapable,
} from '../../../domain/contracts/tax-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CalculateTaxInput,
  CommitTaxTransactionInput,
  ReverseTaxTransactionInput,
  TaxCalculationDTO,
  TaxCapabilities,
  TaxTransactionDTO,
} from '../../../domain/dtos/tax.dto';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import {
  mapStripeTaxCalculation,
  mapStripeTaxTransaction,
  stripeTaxCalculationParams,
} from './stripe-tax-mappers';

export interface StripeTaxProviderOptions {
  secretKey: string;
}

export class StripeTaxProvider
  implements TaxProvider, TaxCalculationCapable, TaxTransactionCapable
{
  readonly name = 'stripe-tax';
  private client?: Stripe;

  constructor(
    private readonly options: StripeTaxProviderOptions,
    client?: Stripe,
  ) {
    this.client = client;
  }

  capabilities(): TaxCapabilities {
    return new Set(['calculations', 'transactions']);
  }

  async calculateTax(input: CalculateTaxInput, ctx: OperationContext): Promise<TaxCalculationDTO> {
    const params = stripeTaxCalculationParams(input);
    const stripe = await this.stripe();
    const calculation = await withStripeErrors(
      () => stripe.tax.calculations.create(params, { idempotencyKey: ctx.idempotencyKey }),
      this.name,
    );
    return mapStripeTaxCalculation(calculation);
  }

  async retrieveTaxCalculation(providerCalculationId: string): Promise<TaxCalculationDTO> {
    const stripe = await this.stripe();
    const calculation = await withStripeErrors(
      () => stripe.tax.calculations.retrieve(providerCalculationId),
      this.name,
    );
    return mapStripeTaxCalculation(calculation);
  }

  async commitTaxTransaction(
    input: CommitTaxTransactionInput,
    ctx: OperationContext,
  ): Promise<TaxTransactionDTO> {
    const stripe = await this.stripe();
    const transaction = await withStripeErrors(
      () =>
        stripe.tax.transactions.createFromCalculation(
          { calculation: input.providerCalculationId, reference: input.reference },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      this.name,
    );
    return mapStripeTaxTransaction(transaction);
  }

  async reverseTaxTransaction(
    input: ReverseTaxTransactionInput,
    ctx: OperationContext,
  ): Promise<TaxTransactionDTO> {
    const stripe = await this.stripe();
    const transaction = await withStripeErrors(
      () =>
        stripe.tax.transactions.createReversal(
          {
            mode: 'full',
            original_transaction: input.providerTransactionId,
            reference: input.reference,
          },
          { idempotencyKey: ctx.idempotencyKey },
        ),
      this.name,
    );
    return mapStripeTaxTransaction(transaction);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeTaxProvider { name: '${this.name}' }`;
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }
}
