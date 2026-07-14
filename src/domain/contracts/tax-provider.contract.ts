import type { OperationContext } from '../dtos/common.dto';
import type {
  CalculateTaxInput,
  CommitTaxTransactionInput,
  ReverseTaxTransactionInput,
  TaxCalculationDTO,
  TaxCapabilities,
  TaxTransactionDTO,
} from '../dtos/tax.dto';

export interface TaxProvider {
  readonly name: string;
  capabilities(): TaxCapabilities;
}

export interface TaxCalculationCapable {
  calculateTax(input: CalculateTaxInput, ctx: OperationContext): Promise<TaxCalculationDTO>;
  retrieveTaxCalculation(providerCalculationId: string): Promise<TaxCalculationDTO>;
}

export interface TaxTransactionCapable {
  commitTaxTransaction(
    input: CommitTaxTransactionInput,
    ctx: OperationContext,
  ): Promise<TaxTransactionDTO>;
  reverseTaxTransaction(
    input: ReverseTaxTransactionInput,
    ctx: OperationContext,
  ): Promise<TaxTransactionDTO>;
}

export function isTaxCalculationCapable(
  provider: TaxProvider,
): provider is TaxProvider & TaxCalculationCapable {
  const candidate = provider as Partial<TaxCalculationCapable>;
  return (
    typeof candidate.calculateTax === 'function' &&
    typeof candidate.retrieveTaxCalculation === 'function'
  );
}

export function isTaxTransactionCapable(
  provider: TaxProvider,
): provider is TaxProvider & TaxTransactionCapable {
  const candidate = provider as Partial<TaxTransactionCapable>;
  return (
    typeof candidate.commitTaxTransaction === 'function' &&
    typeof candidate.reverseTaxTransaction === 'function'
  );
}
