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
import { CatalogPersistenceCoordinator } from '../services/catalog/catalog-persistence-coordinator';
import { normalizeCatalogListInput } from '../services/catalog/normalize-catalog-list-input';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';
import type { CatalogMutationOptions } from './catalog-mutation-options';

export class ProductResource {
  private readonly persistence: CatalogPersistenceCoordinator;

  constructor(private readonly deps: BillingDependencies) {
    this.persistence = new CatalogPersistenceCoordinator(deps);
  }

  async create(input: CreateProductInput, options?: CatalogMutationOptions): Promise<ProductDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'product.create',
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    const operationContext = this.context();
    const product = await provider.createProduct(input, operationContext);
    await this.persistence.persistProduct(product, {
      action: 'product.create',
      authorization: options?.authorization,
      correlationId: operationContext.correlationId,
    });
    return product;
  }

  async update(input: UpdateProductInput, options?: CatalogMutationOptions): Promise<ProductDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'product.update',
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    const operationContext = this.context();
    const product = await provider.updateProduct(input, operationContext);
    await this.persistence.persistProduct(product, {
      action: 'product.update',
      authorization: options?.authorization,
      correlationId: operationContext.correlationId,
    });
    return product;
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
    const operationContext = this.context();
    const product = await provider.setProductActive(id, active, operationContext);
    await this.persistence.persistProduct(product, {
      action,
      authorization: options?.authorization,
      correlationId: operationContext.correlationId,
    });
    return product;
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
