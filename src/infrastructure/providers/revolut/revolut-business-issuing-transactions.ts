import type {
  IssuingTransactionDTO,
  ListIssuingTransactionsInput,
} from '../../../domain/dtos/issuing.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import {
  revolutBusinessTransactionCardId,
  toRevolutBusinessIssuingTransactionDTO,
} from './revolut-business-card-mappers';
import type { RevolutBusinessRequest, RevolutBusinessTransaction } from './revolut-business-types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

export class RevolutBusinessIssuingTransactions {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async list(input: ListIssuingTransactionsInput = {}): Promise<IssuingTransactionDTO[]> {
    if (input.providerAuthorizationId) {
      throw new PayableError('Revolut Business has no issuing authorization filter', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: 'revolut-business-issuing' },
      });
    }
    const limit = input.limit ?? DEFAULT_LIMIT;
    const query = new URLSearchParams({ count: String(Math.min(limit, MAX_LIMIT)) });
    const transactions = await this.request<RevolutBusinessTransaction[]>(
      `/transactions?${query.toString()}`,
      { method: 'GET' },
    );
    return transactions
      .filter((transaction) => {
        const cardId = revolutBusinessTransactionCardId(transaction);
        return Boolean(cardId && (!input.providerCardId || cardId === input.providerCardId));
      })
      .slice(0, limit)
      .map(toRevolutBusinessIssuingTransactionDTO);
  }

  async retrieve(providerTransactionId: string): Promise<IssuingTransactionDTO> {
    const transaction = await this.request<RevolutBusinessTransaction>(
      `/transaction/${encodeURIComponent(providerTransactionId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessIssuingTransactionDTO(transaction);
  }
}
