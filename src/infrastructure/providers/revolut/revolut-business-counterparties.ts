import type {
  ListTreasuryCounterpartiesInput,
  TreasuryCounterpartyDTO,
} from '../../../domain/dtos/treasury.dto';
import { toRevolutBusinessCounterpartyDTO } from './revolut-business-mappers';
import type { RevolutBusinessCounterparty, RevolutBusinessRequest } from './revolut-business-types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

export class RevolutBusinessCounterparties {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async list(input: ListTreasuryCounterpartiesInput = {}): Promise<TreasuryCounterpartyDTO[]> {
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const counterparties = await this.request<RevolutBusinessCounterparty[]>(
      `/counterparties?limit=${limit}`,
      { method: 'GET' },
    );
    return counterparties.map(toRevolutBusinessCounterpartyDTO);
  }

  async retrieve(providerCounterpartyId: string): Promise<TreasuryCounterpartyDTO> {
    const counterparty = await this.request<RevolutBusinessCounterparty>(
      `/counterparties/${encodeURIComponent(providerCounterpartyId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessCounterpartyDTO(counterparty);
  }
}
