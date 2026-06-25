import type { OperationContext } from '../../domain/dtos/common.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../domain/dtos/product.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import type { BillingDependencies } from './billing-dependencies';

export class ProductResource {
  constructor(private readonly deps: BillingDependencies) {}

  create(input: CreateProductInput): Promise<ProductDTO> {
    return this.deps.provider.createProduct(input, this.context());
  }

  update(input: UpdateProductInput): Promise<ProductDTO> {
    return this.deps.provider.updateProduct(input, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
