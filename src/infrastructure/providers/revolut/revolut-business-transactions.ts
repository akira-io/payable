import type {
  ListTreasuryTransactionsInput,
  TreasuryTransactionDTO,
} from '../../../domain/dtos/treasury.dto';
import { toRevolutBusinessTransactionDTO } from './revolut-business-mappers';
import type { RevolutBusinessRequest, RevolutBusinessTransaction } from './revolut-business-types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

export class RevolutBusinessTransactions {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async list(input: ListTreasuryTransactionsInput): Promise<TreasuryTransactionDTO[]> {
    const query = new URLSearchParams({
      account: input.providerAccountId,
      count: String(Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)),
    });
    if (input.from) {
      query.set('from', input.from.toISOString());
    }
    if (input.to) {
      query.set('to', input.to.toISOString());
    }
    const transactions = await this.request<RevolutBusinessTransaction[]>(
      `/transactions?${query.toString()}`,
      { method: 'GET' },
    );
    return transactions.map(toRevolutBusinessTransactionDTO);
  }

  async retrieve(providerTransactionId: string): Promise<TreasuryTransactionDTO> {
    const transaction = await this.request<RevolutBusinessTransaction>(
      `/transaction/${encodeURIComponent(providerTransactionId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessTransactionDTO(transaction);
  }
}
