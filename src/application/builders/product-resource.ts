import { isCatalogCapable } from '../../domain/contracts/payment-provider.contract';
import type { OperationContext } from '../../domain/dtos/common.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../domain/dtos/product.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';

export class ProductResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(input: CreateProductInput): Promise<ProductDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return provider.createProduct(input, this.context());
  }

  async update(input: UpdateProductInput): Promise<ProductDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return provider.updateProduct(input, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
