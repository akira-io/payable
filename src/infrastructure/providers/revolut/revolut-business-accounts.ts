import type {
  ListTreasuryAccountsInput,
  TreasuryAccountDTO,
} from '../../../domain/dtos/treasury.dto';
import { toRevolutBusinessAccountDTO } from './revolut-business-mappers';
import type { RevolutBusinessAccount, RevolutBusinessRequest } from './revolut-business-types';

const DEFAULT_LIMIT = 100;

export class RevolutBusinessAccounts {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async list(input: ListTreasuryAccountsInput = {}): Promise<TreasuryAccountDTO[]> {
    const accounts = await this.request<RevolutBusinessAccount[]>('/accounts', { method: 'GET' });
    return accounts.slice(0, input.limit ?? DEFAULT_LIMIT).map(toRevolutBusinessAccountDTO);
  }

  async retrieve(providerAccountId: string): Promise<TreasuryAccountDTO> {
    const account = await this.request<RevolutBusinessAccount>(
      `/accounts/${encodeURIComponent(providerAccountId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessAccountDTO(account);
  }
}
