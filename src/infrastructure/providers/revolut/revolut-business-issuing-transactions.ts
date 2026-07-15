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
    const pageSize = Math.min(Math.max(limit, 1), MAX_LIMIT);
    const seen = new Set<string>();
    const matches: IssuingTransactionDTO[] = [];
    let to: string | undefined;
    for (;;) {
      const query = new URLSearchParams({ count: String(pageSize) });
      if (to) {
        query.set('to', to);
      }
      const page = await this.request<RevolutBusinessTransaction[]>(
        `/transactions?${query.toString()}`,
        { method: 'GET' },
      );
      for (const transaction of page) {
        if (seen.has(transaction.id)) {
          continue;
        }
        seen.add(transaction.id);
        const cardId = revolutBusinessTransactionCardId(transaction);
        if (cardId && (!input.providerCardId || cardId === input.providerCardId)) {
          matches.push(toRevolutBusinessIssuingTransactionDTO(transaction));
          if (matches.length >= limit) {
            return matches;
          }
        }
      }
      if (page.length < pageSize) {
        return matches;
      }
      const cursor = page.at(-1)?.created_at;
      if (!cursor || cursor === to) {
        return matches;
      }
      to = cursor;
    }
  }

  async retrieve(providerTransactionId: string): Promise<IssuingTransactionDTO> {
    const transaction = await this.request<RevolutBusinessTransaction>(
      `/transaction/${encodeURIComponent(providerTransactionId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessIssuingTransactionDTO(transaction);
  }
}
