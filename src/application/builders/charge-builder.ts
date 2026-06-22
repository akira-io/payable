import type { ChargeResultDTO } from '../../domain/dtos/charge.dto';
import { PayableError } from '../../domain/errors/payable-error';
import type { Money } from '../../domain/value-objects/money';

export interface ChargeRequest {
  amount: Money;
  reference?: string;
  description?: string;
}

export class ChargeBuilder {
  private readonly state: { request?: ChargeRequest } = {};

  for(request: ChargeRequest): this {
    this.state.request = request;
    return this;
  }

  // TODO: Phase 10 - execute a one-time charge through the provider.
  async execute(): Promise<ChargeResultDTO> {
    throw PayableError.notImplemented(
      `ChargeBuilder.execute (${this.state.request?.reference ?? 'no-reference'})`,
    );
  }
}
