import type {
  AccountingLabelDTO,
  AccountingListInput,
  CreateAccountingLabelInput,
  UpdateAccountingLabelInput,
} from '../../../domain/dtos/accounting.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { mapRevolutAccountingLabel } from './revolut-accounting-mappers';
import {
  collectRevolutAccountingPages,
  REVOLUT_ACCOUNTING_PAGE_SIZE,
} from './revolut-accounting-pagination';
import type {
  RevolutAccountingLabel,
  RevolutAccountingLabelGroup,
  RevolutBusinessCreatedResource,
  RevolutBusinessRequest,
} from './revolut-business-types';

interface LabelAddress {
  groupId: string;
  labelId: string;
}

export class RevolutAccountingLabels {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async create(
    input: CreateAccountingLabelInput,
    _ctx: OperationContext,
  ): Promise<AccountingLabelDTO> {
    if (!input.providerGroupId) {
      throw accountingLabelError('Revolut accounting labels require a label group ID');
    }
    const created = await this.request<RevolutBusinessCreatedResource>(
      this.groupLabelsPath(input.providerGroupId),
      { method: 'POST', body: { name: input.name } },
    );
    return this.find(input.providerGroupId, created.id);
  }

  async list(input: AccountingListInput = {}): Promise<AccountingLabelDTO[]> {
    const limit = Math.max(0, input.limit ?? 100);
    const groups = await collectRevolutAccountingPages<RevolutAccountingLabelGroup>(
      this.request,
      '/label-groups',
      'label_groups',
      REVOLUT_ACCOUNTING_PAGE_SIZE,
    );
    const labels: AccountingLabelDTO[] = [];
    for (const group of groups) {
      if (labels.length >= limit) {
        break;
      }
      const groupLabels = await this.listGroup(group.id, limit - labels.length);
      labels.push(...groupLabels);
    }
    return labels;
  }

  async retrieve(providerLabelId: string): Promise<AccountingLabelDTO> {
    const address = labelAddress(providerLabelId);
    return this.find(address.groupId, address.labelId);
  }

  async update(
    input: UpdateAccountingLabelInput,
    _ctx: OperationContext,
  ): Promise<AccountingLabelDTO> {
    const address = labelAddress(input.providerLabelId, input.providerGroupId);
    await this.request(this.labelPath(address), {
      method: 'PATCH',
      body: { name: input.name },
    });
    return this.find(address.groupId, address.labelId);
  }

  async delete(providerLabelId: string, _ctx: OperationContext): Promise<void> {
    await this.request(this.labelPath(labelAddress(providerLabelId)), { method: 'DELETE' });
  }

  private async find(groupId: string, labelId: string): Promise<AccountingLabelDTO> {
    const labels = await this.listGroup(groupId, REVOLUT_ACCOUNTING_PAGE_SIZE);
    const label = labels.find((candidate) => candidate.providerLabelId === `${groupId}:${labelId}`);
    if (!label) {
      throw accountingLabelError('Revolut accounting label was not found');
    }
    return label;
  }

  private async listGroup(groupId: string, limit: number): Promise<AccountingLabelDTO[]> {
    const labels = await collectRevolutAccountingPages<RevolutAccountingLabel>(
      this.request,
      this.groupLabelsPath(groupId),
      'labels',
      limit,
    );
    return labels.map((label) => mapRevolutAccountingLabel(label, groupId));
  }

  private groupLabelsPath(groupId: string): string {
    return `/label-groups/${encodeURIComponent(groupId)}/labels`;
  }

  private labelPath(address: LabelAddress): string {
    return `${this.groupLabelsPath(address.groupId)}/${encodeURIComponent(address.labelId)}`;
  }
}

function labelAddress(providerLabelId: string, providerGroupId?: string): LabelAddress {
  const separator = providerLabelId.indexOf(':');
  if (separator > 0) {
    return {
      groupId: providerGroupId ?? providerLabelId.slice(0, separator),
      labelId: providerLabelId.slice(separator + 1),
    };
  }
  if (providerGroupId) {
    return { groupId: providerGroupId, labelId: providerLabelId };
  }
  throw accountingLabelError('Revolut accounting label IDs must include their label group');
}

function accountingLabelError(message: string): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_REQUEST_INVALID',
    context: { provider: 'revolut-business-accounting' },
  });
}
