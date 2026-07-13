import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateTreasuryExchangeInput,
  TreasuryExchangeDTO,
  TreasuryExchangeQuoteDTO,
  TreasuryExchangeQuoteInput,
} from '../../../domain/dtos/treasury.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { revolutBusinessAmount } from './revolut-business-amounts';
import {
  toRevolutBusinessExchangeDTO,
  toRevolutBusinessExchangeQuoteDTO,
} from './revolut-business-mappers';
import { revolutBusinessRequestId } from './revolut-business-request-id';
import type {
  RevolutBusinessExchangeQuote,
  RevolutBusinessExchangeResponse,
  RevolutBusinessRequest,
} from './revolut-business-types';

export class RevolutBusinessExchange {
  constructor(private readonly request: RevolutBusinessRequest) {}

  async quote(input: TreasuryExchangeQuoteInput): Promise<TreasuryExchangeQuoteDTO> {
    const query = new URLSearchParams({
      from: input.sourceAmount.currency(),
      to: input.targetCurrency,
      amount: String(revolutBusinessAmount(input.sourceAmount)),
    });
    const quote = await this.request<RevolutBusinessExchangeQuote>(`/rate?${query.toString()}`, {
      method: 'GET',
    });
    return toRevolutBusinessExchangeQuoteDTO(quote);
  }

  async create(
    input: CreateTreasuryExchangeInput,
    context: OperationContext,
  ): Promise<TreasuryExchangeDTO> {
    assertAmountCurrency(input);
    const body = {
      from: {
        account_id: input.sourceProviderAccountId,
        currency: input.sourceCurrency,
        ...(input.sourceAmount ? { amount: revolutBusinessAmount(input.sourceAmount) } : {}),
      },
      to: {
        account_id: input.targetProviderAccountId,
        currency: input.targetCurrency,
        ...(input.targetAmount ? { amount: revolutBusinessAmount(input.targetAmount) } : {}),
      },
      request_id: revolutBusinessRequestId(context),
      reference: input.reference,
    };
    const exchange = await this.request<RevolutBusinessExchangeResponse>('/exchange', {
      method: 'POST',
      body,
    });
    return toRevolutBusinessExchangeDTO(exchange);
  }
}

function assertAmountCurrency(input: CreateTreasuryExchangeInput): void {
  const amount = input.sourceAmount ?? input.targetAmount;
  const declared = input.sourceAmount ? input.sourceCurrency : input.targetCurrency;
  if (amount.currency() !== declared) {
    throw new PayableError('Revolut Business exchange amount currency does not match its leg', {
      code: 'PROVIDER_REQUEST_INVALID',
      context: {
        provider: 'revolut-business-treasury',
        amountCurrency: amount.currency(),
        declaredCurrency: declared,
      },
    });
  }
}
