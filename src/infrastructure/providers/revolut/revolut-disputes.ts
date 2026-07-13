import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { DisputeDTO, ListDisputesInput } from '../../../domain/dtos/dispute.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { toRevolutDisputeDTO } from './revolut-mappers';
import type { RevolutDispute, RevolutEnvironment, RevolutRequest } from './revolut-types';

const DEFAULT_DISPUTE_LIMIT = 100;
const MAX_DISPUTE_LIMIT = 500;

export class RevolutDisputes {
  constructor(
    private readonly request: RevolutRequest,
    private readonly environment: RevolutEnvironment,
  ) {}

  async list(input: ListDisputesInput = {}): Promise<DisputeDTO[]> {
    this.assertProduction();
    const limit = Math.min(input.limit ?? DEFAULT_DISPUTE_LIMIT, MAX_DISPUTE_LIMIT);
    const disputes = await this.request<RevolutDispute[]>(`/api/disputes?limit=${limit}`, {
      method: 'GET',
    });
    return disputes.map(toRevolutDisputeDTO);
  }

  async retrieve(providerDisputeId: string): Promise<DisputeDTO> {
    this.assertProduction();
    const dispute = await this.request<RevolutDispute>(
      `/api/disputes/${encodeURIComponent(providerDisputeId)}`,
      { method: 'GET' },
    );
    return toRevolutDisputeDTO(dispute);
  }

  async accept(providerDisputeId: string, _ctx: OperationContext): Promise<void> {
    this.assertProduction();
    await this.request(`/api/disputes/${encodeURIComponent(providerDisputeId)}/accept`, {
      method: 'POST',
    });
  }

  private assertProduction(): void {
    if (this.environment === 'sandbox') {
      throw new PayableError('Revolut disputes are unavailable in the sandbox environment', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: 'revolut', environment: this.environment },
      });
    }
  }
}
