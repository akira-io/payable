import type { PriceDTO } from '../../../domain/dtos/price.dto';
import type { ProductDTO } from '../../../domain/dtos/product.dto';
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

    await storage.transaction(async (repositories) => {
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
        throw new Error(`Product ${product.providerProductId} changed during catalog persistence`);
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
    const productId = resolvedProductId ?? (await this.resolveProductId(price.providerProductId));
    if (!productId) {
      return;
    }
    const tenantId = this.dependencies.tenantId ?? null;
    const target = newPriceFromDto(price, productId, this.dependencies.providerName, tenantId);

    await storage.transaction(async (repositories) => {
      const before = await repositories.prices.findByProviderId(
        this.dependencies.providerName,
        price.providerPriceId,
        tenantId,
      );
      if (before && priceMatches(before, target)) {
        return;
      }
      const after = before
        ? await updateCatalogPrice(repositories.prices, before, target, tenantId)
        : await repositories.prices.create(target);
      if (!after) {
        const concurrent = await repositories.prices.findByProviderId(
          this.dependencies.providerName,
          price.providerPriceId,
          tenantId,
        );
        if (concurrent && priceMatches(concurrent, target)) {
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
  }
}
