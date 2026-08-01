import {
  isCatalogCapable,
  isCatalogLifecycleCapable,
  isCatalogReadCapable,
} from '../../domain/contracts/payment-provider.contract';
import type { CatalogPage, ListProductsInput } from '../../domain/dtos/catalog.dto';
import type { OperationContext } from '../../domain/dtos/common.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../domain/dtos/product.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { assertAuthorized } from '../policies/assert-authorized';
import { type AuthorizationContext, isAuthorized } from '../policies/authorization-context';
import { normalizeCatalogListInput } from '../services/catalog/normalize-catalog-list-input';
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

  async retrieve(id: string): Promise<ProductDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogRead', isCatalogReadCapable);
    return provider.retrieveProduct(id);
  }

  async list(input?: ListProductsInput): Promise<CatalogPage<ProductDTO>> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogRead', isCatalogReadCapable);
    return provider.listProducts(normalizeCatalogListInput(input));
  }

  async activate(id: string, authorization?: AuthorizationContext): Promise<ProductDTO> {
    return this.setActive(id, true, authorization);
  }

  async archive(id: string, authorization?: AuthorizationContext): Promise<ProductDTO> {
    return this.setActive(id, false, authorization);
  }

  private async setActive(
    id: string,
    active: boolean,
    authorization?: AuthorizationContext,
  ): Promise<ProductDTO> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      isAuthorized,
      authorization,
      `${active ? 'activate' : 'archive'} product`,
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogLifecycle', isCatalogLifecycleCapable);
    return provider.setProductActive(id, active, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
