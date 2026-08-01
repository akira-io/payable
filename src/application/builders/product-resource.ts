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
import { assertCatalogMutationAuthorized } from '../policies/catalog-mutation-authorization';
import { normalizeCatalogListInput } from '../services/catalog/normalize-catalog-list-input';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';
import type { CatalogMutationOptions } from './catalog-mutation-options';

export class ProductResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(input: CreateProductInput, options?: CatalogMutationOptions): Promise<ProductDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'product.create',
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return provider.createProduct(input, this.context());
  }

  async update(input: UpdateProductInput, options?: CatalogMutationOptions): Promise<ProductDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'product.update',
    );
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

  async activate(id: string, options?: CatalogMutationOptions): Promise<ProductDTO> {
    return this.setActive(id, true, options, 'product.activate');
  }

  async archive(id: string, options?: CatalogMutationOptions): Promise<ProductDTO> {
    return this.setActive(id, false, options, 'product.archive');
  }

  private async setActive(
    id: string,
    active: boolean,
    options: CatalogMutationOptions | undefined,
    action: 'product.activate' | 'product.archive',
  ): Promise<ProductDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      action,
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogLifecycle', isCatalogLifecycleCapable);
    return provider.setProductActive(id, active, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
