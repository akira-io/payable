import type { ListPayoutsInput, PayoutDTO } from '../../../domain/dtos/payout.dto';
import { toRevolutPayoutDTO } from './revolut-mappers';
import type { RevolutPayout, RevolutRequest } from './revolut-types';

const DEFAULT_PAYOUT_LIMIT = 100;
const MAX_PAYOUT_LIMIT = 500;

export class RevolutPayouts {
  constructor(private readonly request: RevolutRequest) {}

  async list(input: ListPayoutsInput = {}): Promise<PayoutDTO[]> {
    const limit = Math.min(input.limit ?? DEFAULT_PAYOUT_LIMIT, MAX_PAYOUT_LIMIT);
    const payouts = await this.request<RevolutPayout[]>(`/api/payouts?limit=${limit}`, {
      method: 'GET',
    });
    return payouts.map(toRevolutPayoutDTO);
  }

  async retrieve(providerPayoutId: string): Promise<PayoutDTO> {
    const payout = await this.request<RevolutPayout>(
      `/api/payouts/${encodeURIComponent(providerPayoutId)}`,
      { method: 'GET' },
    );
    return toRevolutPayoutDTO(payout);
  }
}
