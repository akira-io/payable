import type { ProductDTO } from '../../../domain/dtos/product.dto';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import type { CatalogMutationAction } from '../../policies/catalog-mutation-authorization';
import { recordCatalogTransition } from './catalog-persistence-events';
import { newProductFromDto, productMatches, productSnapshot } from './catalog-persistence-snapshot';

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
        ? await repositories.products.update(before.id, target, tenantId)
        : await repositories.products.create(target);
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
}
