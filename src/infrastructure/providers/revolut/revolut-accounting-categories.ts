import type {
  AccountingCategoryDTO,
  AccountingListInput,
  CreateAccountingCategoryInput,
  UpdateAccountingCategoryInput,
} from '../../../domain/dtos/accounting.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { mapRevolutAccountingCategory } from './revolut-accounting-mappers';
import { collectRevolutAccountingPages } from './revolut-accounting-pagination';
import type {
  RevolutAccountingCategory,
  RevolutBusinessCreatedResource,
  RevolutBusinessRequest,
} from './revolut-business-types';

export class RevolutAccountingCategories {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async create(
    input: CreateAccountingCategoryInput,
    _ctx: OperationContext,
  ): Promise<AccountingCategoryDTO> {
    if (!input.code) {
      throw new PayableError('Revolut accounting categories require a code', {
        code: 'PROVIDER_REQUEST_INVALID',
        context: { provider: 'revolut-business-accounting' },
      });
    }
    const created = await this.request<RevolutBusinessCreatedResource>('/accounting-categories', {
      method: 'POST',
      body: {
        name: input.name,
        code: input.code,
        default_tax_rate_id: input.providerDefaultTaxRateId,
      },
    });
    return this.retrieve(created.id);
  }

  async list(input: AccountingListInput = {}): Promise<AccountingCategoryDTO[]> {
    const categories = await collectRevolutAccountingPages<RevolutAccountingCategory>(
      this.request,
      '/accounting-categories',
      'accounting_categories',
      input.limit,
    );
    return categories.map(mapRevolutAccountingCategory);
  }

  async retrieve(providerCategoryId: string): Promise<AccountingCategoryDTO> {
    const category = await this.request<RevolutAccountingCategory>(
      `/accounting-categories/${encodeURIComponent(providerCategoryId)}`,
      { method: 'GET' },
    );
    return mapRevolutAccountingCategory(category);
  }

  async update(
    input: UpdateAccountingCategoryInput,
    _ctx: OperationContext,
  ): Promise<AccountingCategoryDTO> {
    await this.request(`/accounting-categories/${encodeURIComponent(input.providerCategoryId)}`, {
      method: 'PATCH',
      body: {
        name: input.name,
        code: input.code,
        default_tax_rate_id: input.providerDefaultTaxRateId,
      },
    });
    return this.retrieve(input.providerCategoryId);
  }

  async delete(providerCategoryId: string, _ctx: OperationContext): Promise<void> {
    await this.request(`/accounting-categories/${encodeURIComponent(providerCategoryId)}`, {
      method: 'DELETE',
    });
  }
}
