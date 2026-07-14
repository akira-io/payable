import type {
  AccountingListInput,
  AccountingTaxRateDTO,
  CreateAccountingTaxRateInput,
  UpdateAccountingTaxRateInput,
} from '../../../domain/dtos/accounting.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { mapRevolutAccountingTaxRate } from './revolut-accounting-mappers';
import { collectRevolutAccountingPages } from './revolut-accounting-pagination';
import type {
  RevolutAccountingTaxRate,
  RevolutBusinessCreatedResource,
  RevolutBusinessRequest,
} from './revolut-business-types';

export class RevolutAccountingTaxRates {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async create(
    input: CreateAccountingTaxRateInput,
    _ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO> {
    const created = await this.request<RevolutBusinessCreatedResource>('/tax-rates', {
      method: 'POST',
      body: { name: input.name, percentage: input.percentage },
    });
    return this.retrieve(created.id);
  }

  async list(input: AccountingListInput = {}): Promise<AccountingTaxRateDTO[]> {
    const taxRates = await collectRevolutAccountingPages<RevolutAccountingTaxRate>(
      this.request,
      '/tax-rates',
      'tax_rates',
      input.limit,
    );
    return taxRates.map(mapRevolutAccountingTaxRate);
  }

  async retrieve(providerTaxRateId: string): Promise<AccountingTaxRateDTO> {
    const taxRate = await this.request<RevolutAccountingTaxRate>(
      `/tax-rates/${encodeURIComponent(providerTaxRateId)}`,
      { method: 'GET' },
    );
    return mapRevolutAccountingTaxRate(taxRate);
  }

  async update(
    input: UpdateAccountingTaxRateInput,
    _ctx: OperationContext,
  ): Promise<AccountingTaxRateDTO> {
    await this.request(`/tax-rates/${encodeURIComponent(input.providerTaxRateId)}`, {
      method: 'PATCH',
      body: { name: input.name },
    });
    return this.retrieve(input.providerTaxRateId);
  }

  async delete(providerTaxRateId: string, _ctx: OperationContext): Promise<void> {
    await this.request(`/tax-rates/${encodeURIComponent(providerTaxRateId)}`, {
      method: 'DELETE',
    });
  }
}
