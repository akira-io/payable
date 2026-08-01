import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
import {
  CatalogPersistenceError,
  type CatalogPersistenceFailure,
} from '../../../domain/errors/catalog-persistence.error';
import { ProductNotFoundError } from '../../../domain/errors/product-not-found.error';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import type { CatalogMutationAction } from '../../policies/catalog-mutation-authorization';
import { recordCatalogTransition } from './catalog-persistence-events';
import {
  newPriceFromDto,
  newProductFromDto,
  priceMatches,
  priceSnapshot,
  productMatches,
  productSnapshot,
} from './catalog-persistence-snapshot';
import { updateCatalogPrice, updateCatalogProduct } from './catalog-repository-compare-and-set';

export interface CatalogTransitionContext {
  action: CatalogMutationAction;
  authorization?: AuthorizationContext;
  correlationId: string;
}

export class CatalogPersistenceCoordinator {
  constructor(private readonly dependencies: BillingDependencies) {}

  async persistProduct(product: ProductDTO, context: CatalogTransitionContext): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return;
    }
    const tenantId = this.dependencies.tenantId ?? null;
    const target = newProductFromDto(product, this.dependencies.providerName, tenantId);

    await this.persistWithRecovery({
      failure: this.persistenceFailure('product', product.providerProductId, context),
      persist: () =>
        storage.transaction(async (repositories) => {
          const before = await repositories.products.findByProviderId(
            this.dependencies.providerName,
            product.providerProductId,
            tenantId,
          );
          if (before && productMatches(before, target)) {
            return;
          }
          const after = before
            ? await updateCatalogProduct(repositories.products, before, target, tenantId)
            : await repositories.products.create(target);
          if (!after) {
            const concurrent = await repositories.products.findByProviderId(
              this.dependencies.providerName,
              product.providerProductId,
              tenantId,
            );
            if (concurrent && productMatches(concurrent, target)) {
              return;
            }
            throw new Error(
              `Product ${product.providerProductId} changed during catalog persistence`,
            );
          }
          await recordCatalogTransition(repositories, {
            resourceType: 'product',
            resourceId: after.id,
            provider: this.dependencies.providerName,
            providerResourceId: product.providerProductId,
            tenantId,
            before: before ? productSnapshot(before) : null,
            after: productSnapshot(after),
            context,
          });
        }),
      isDurable: async () => {
        const durable = await storage.products.findByProviderId(
          this.dependencies.providerName,
          product.providerProductId,
          tenantId,
        );
        return durable !== null && productMatches(durable, target);
      },
    });
  }

  async resolveProductId(providerProductId: string): Promise<string | undefined> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return undefined;
    }
    const product = await storage.products.findByProviderId(
      this.dependencies.providerName,
      providerProductId,
      this.dependencies.tenantId ?? null,
    );
    if (!product) {
      throw new ProductNotFoundError(providerProductId);
    }
    return product.id;
  }

  async persistPrice(
    price: PriceDTO,
    context: CatalogTransitionContext,
    resolvedProductId?: string,
  ): Promise<void> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return;
    }
    const tenantId = this.dependencies.tenantId ?? null;
    let target = resolvedProductId
      ? newPriceFromDto(price, resolvedProductId, this.dependencies.providerName, tenantId)
      : undefined;

    await this.persistWithRecovery({
      failure: this.persistenceFailure('price', price.providerPriceId, context),
      persist: async () => {
        const productId =
          resolvedProductId ?? (await this.resolveProductId(price.providerProductId));
        if (!productId) {
          return;
        }
        const durableTarget = newPriceFromDto(
          price,
          productId,
          this.dependencies.providerName,
          tenantId,
        );
        target = durableTarget;
        await storage.transaction(async (repositories) => {
          const before = await repositories.prices.findByProviderId(
            this.dependencies.providerName,
            price.providerPriceId,
            tenantId,
          );
          if (before && priceMatches(before, durableTarget)) {
            return;
          }
          const after = before
            ? await updateCatalogPrice(repositories.prices, before, durableTarget, tenantId)
            : await repositories.prices.create(durableTarget);
          if (!after) {
            const concurrent = await repositories.prices.findByProviderId(
              this.dependencies.providerName,
              price.providerPriceId,
              tenantId,
            );
            if (concurrent && priceMatches(concurrent, durableTarget)) {
              return;
            }
            throw new Error(`Price ${price.providerPriceId} changed during catalog persistence`);
          }
          await recordCatalogTransition(repositories, {
            resourceType: 'price',
            resourceId: after.id,
            provider: this.dependencies.providerName,
            providerResourceId: price.providerPriceId,
            tenantId,
            before: before ? priceSnapshot(before) : null,
            after: priceSnapshot(after),
            context,
          });
        });
      },
      isDurable: async () => {
        const durable = await storage.prices.findByProviderId(
          this.dependencies.providerName,
          price.providerPriceId,
          tenantId,
        );
        return target !== undefined && durable !== null && priceMatches(durable, target);
      },
    });
  }

  private async persistWithRecovery(input: {
    failure: CatalogPersistenceFailure;
    persist: () => Promise<void>;
    isDurable: () => Promise<boolean>;
  }): Promise<void> {
    try {
      await input.persist();
      return;
    } catch (error) {
      if (await this.isDurableAfterFailure(input.isDurable)) {
        return;
      }
      throw new CatalogPersistenceError(input.failure, { cause: error });
    }
  }

  private async isDurableAfterFailure(isDurable: () => Promise<boolean>): Promise<boolean> {
    try {
      return await isDurable();
    } catch {
      return false;
    }
  }

  private persistenceFailure(
    resourceType: CatalogPersistenceFailure['resourceType'],
    providerResourceId: string,
    context: CatalogTransitionContext,
  ): CatalogPersistenceFailure {
    return {
      resourceType,
      action: context.action,
      provider: this.dependencies.providerName,
      providerResourceId,
      tenantId: this.dependencies.tenantId ?? null,
      correlationId: context.correlationId,
    };
  }
}
