import {
  isCatalogCapable,
  isCatalogLifecycleCapable,
  isCatalogReadCapable,
} from '../../domain/contracts/payment-provider.contract';
import type { CatalogPage, ListPricesInput } from '../../domain/dtos/catalog.dto';
import type { OperationContext } from '../../domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../domain/dtos/price.dto';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import { assertCatalogMutationAuthorized } from '../policies/catalog-mutation-authorization';
import { normalizeCatalogListInput } from '../services/catalog/normalize-catalog-list-input';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';
import type { CatalogMutationOptions } from './catalog-mutation-options';

export class PriceResource {
  constructor(private readonly deps: BillingDependencies) {}

  async create(input: CreatePriceInput, options?: CatalogMutationOptions): Promise<PriceDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'price.create',
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return provider.createPrice(input, this.context());
  }

  async retrieve(id: string): Promise<PriceDTO> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogRead', isCatalogReadCapable);
    return provider.retrievePrice(id);
  }

  async list(input?: ListPricesInput): Promise<CatalogPage<PriceDTO>> {
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogRead', isCatalogReadCapable);
    return provider.listPrices(normalizeCatalogListInput(input));
  }

  async activate(id: string, options?: CatalogMutationOptions): Promise<PriceDTO> {
    return this.setActive(id, true, options, 'price.activate');
  }

  async archive(id: string, options?: CatalogMutationOptions): Promise<PriceDTO> {
    return this.setActive(id, false, options, 'price.archive');
  }

  private async setActive(
    id: string,
    active: boolean,
    options: CatalogMutationOptions | undefined,
    action: 'price.activate' | 'price.archive',
  ): Promise<PriceDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      action,
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalogLifecycle', isCatalogLifecycleCapable);
    return provider.setPriceActive(id, active, this.context());
  }

  private context(): OperationContext {
    return { correlationId: CorrelationId.generate().toString() };
  }
}
