import {
  isCatalogCapable,
  isCatalogLifecycleCapable,
  isCatalogReadCapable,
} from '../../domain/contracts/payment-provider.contract';
import type { CatalogPage, ListPricesInput } from '../../domain/dtos/catalog.dto';
import type { CreatePriceInput, PriceDTO } from '../../domain/dtos/price.dto';
import { assertCatalogMutationAuthorized } from '../policies/catalog-mutation-authorization';
import { revivePrice } from '../services/catalog/catalog-idempotency-result';
import { CatalogMutationIdempotencyExecutor } from '../services/catalog/catalog-mutation-idempotency-executor';
import { CatalogPersistenceCoordinator } from '../services/catalog/catalog-persistence-coordinator';
import { normalizeCatalogListInput } from '../services/catalog/normalize-catalog-list-input';
import { assertCapableProvider } from '../services/provider-capabilities/assert-provider-capability';
import type { BillingDependencies } from './billing-dependencies';
import type { CatalogMutationOptions } from './catalog-mutation-options';

export class PriceResource {
  private readonly idempotency: CatalogMutationIdempotencyExecutor;
  private readonly persistence: CatalogPersistenceCoordinator;

  constructor(private readonly deps: BillingDependencies) {
    this.idempotency = new CatalogMutationIdempotencyExecutor(deps);
    this.persistence = new CatalogPersistenceCoordinator(deps);
  }

  async create(input: CreatePriceInput, options?: CatalogMutationOptions): Promise<PriceDTO> {
    assertCatalogMutationAuthorized(
      this.deps.authorizationEnabled ?? false,
      options?.authorization,
      'price.create',
    );
    const provider = this.deps.provider;
    assertCapableProvider(provider, 'catalog', isCatalogCapable);
    return this.idempotency.execute({
      action: 'price.create',
      callerKey: options?.idempotencyKey,
      request: input,
      resourceType: 'price',
      run: async (operationContext) => {
        const productId = await this.persistence.resolveProductId(input.providerProductId);
        const price = await provider.createPrice(input, operationContext);
        await this.persistence.persistPrice(
          price,
          {
            action: 'price.create',
            authorization: options?.authorization,
            correlationId: operationContext.correlationId,
          },
          productId,
        );
        return price;
      },
      revive: revivePrice,
    });
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
    return this.idempotency.execute({
      action,
      callerKey: options?.idempotencyKey,
      request: { id, active },
      resourceType: 'price',
      resourceId: id,
      run: async (operationContext) => {
        const price = await provider.setPriceActive(id, active, operationContext);
        await this.persistence.persistPrice(price, {
          action,
          authorization: options?.authorization,
          correlationId: operationContext.correlationId,
        });
        return price;
      },
      revive: revivePrice,
    });
  }
}
