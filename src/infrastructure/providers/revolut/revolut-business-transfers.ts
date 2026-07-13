import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateTreasuryTransferInput,
  ListTreasuryTransfersInput,
  TreasuryTransferDTO,
} from '../../../domain/dtos/treasury.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { revolutBusinessAmount } from './revolut-business-amounts';
import {
  toCreatedRevolutBusinessTransferDTO,
  toRevolutBusinessTransferDTO,
} from './revolut-business-mappers';
import { revolutBusinessRequestId } from './revolut-business-request-id';
import type {
  RevolutBusinessRequest,
  RevolutBusinessTransaction,
  RevolutBusinessTransferResponse,
} from './revolut-business-types';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

export class RevolutBusinessTransfers {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async create(
    input: CreateTreasuryTransferInput,
    context: OperationContext,
  ): Promise<TreasuryTransferDTO> {
    const transferFields = {
      request_id: revolutBusinessRequestId(context),
      amount: revolutBusinessAmount(input.amount),
      currency: input.amount.currency(),
      reference: input.reference,
    };
    const request = transferRequest(input, transferFields);
    const response = await this.request<RevolutBusinessTransferResponse>(request.path, {
      method: 'POST',
      body: request.body,
    });
    return toCreatedRevolutBusinessTransferDTO(response, input);
  }

  async list(input: ListTreasuryTransfersInput): Promise<TreasuryTransferDTO[]> {
    const query = new URLSearchParams({
      account: input.providerAccountId,
      type: 'transfer',
      count: String(Math.min(input.limit ?? DEFAULT_LIMIT, MAX_LIMIT)),
    });
    const transactions = await this.request<RevolutBusinessTransaction[]>(
      `/transactions?${query.toString()}`,
      { method: 'GET' },
    );
    return transactions.map(toRevolutBusinessTransferDTO);
  }

  async retrieve(providerTransferId: string): Promise<TreasuryTransferDTO> {
    const transaction = await this.request<RevolutBusinessTransaction>(
      `/transaction/${encodeURIComponent(providerTransferId)}`,
      { method: 'GET' },
    );
    return toRevolutBusinessTransferDTO(transaction);
  }
}

interface RevolutBusinessTransferRequest {
  path: '/transfer' | '/pay';
  body: Record<string, unknown>;
}

function transferRequest(
  input: CreateTreasuryTransferInput,
  transferFields: Record<string, unknown>,
): RevolutBusinessTransferRequest {
  const destination = input.destination;
  if (destination.type === 'account') {
    return {
      path: '/transfer',
      body: {
        ...transferFields,
        source_account_id: input.sourceProviderAccountId,
        target_account_id: destination.providerAccountId,
      },
    };
  }
  if (destination.type === 'counterparty') {
    return {
      path: '/pay',
      body: {
        ...transferFields,
        account_id: input.sourceProviderAccountId,
        receiver: {
          counterparty_id: destination.providerCounterpartyId,
          account_id: destination.providerAccountId,
        },
      },
    };
  }
  throw unsupportedDestination(destination.type);
}

function unsupportedDestination(destinationType: string): PayableError {
  return new PayableError('Revolut Business does not support payment method destinations', {
    code: 'PROVIDER_TREASURY_DESTINATION_UNSUPPORTED',
    context: { provider: 'revolut-business-treasury', destinationType },
  });
}
