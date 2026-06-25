import type { OperationContext } from '../../domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../domain/dtos/price.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { assertProviderCapability } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';

export class PriceResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(input: CreatePriceInput): Promise<PriceDTO> {
    assertProviderCapability(this.deps.provider, 'catalog');
    return this.deps.provider.createPrice(input, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
