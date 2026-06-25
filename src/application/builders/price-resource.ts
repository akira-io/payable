import { isCatalogCapable } from '../../domain/contracts/payment-provider.contract';
import type { OperationContext } from '../../domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../domain/dtos/price.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';

export class PriceResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(input: CreatePriceInput): Promise<PriceDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return provider.createPrice(input, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
