import { deriveCatalogProviderKey } from '../../src/application/services/catalog/catalog-idempotency-key';
import { createPayable } from '../../src/create-payable';
import type { OperationContext } from '../../src/domain/dtos/common.dto';
import type { CreatePriceInput, PriceDTO } from '../../src/domain/dtos/price.dto';
import type {
  CreateProductInput,
  ProductDTO,
  UpdateProductInput,
} from '../../src/domain/dtos/product.dto';
import type { CatalogPersistenceAction } from '../../src/domain/entities/catalog-mutation.entity';
import { FakeProvider } from './fake-provider';
import { InMemoryIdempotencyStore } from './fakes';

export interface CatalogHttpRequest {
  body?: Record<string, unknown>;
  key?: string;
  method: 'PATCH' | 'POST';
  path: string;
}

export interface CatalogWriteCase extends CatalogHttpRequest {
  action: CatalogPersistenceAction;
  expectedStatus: number;
}

export const CATALOG_WRITE_CASES: readonly CatalogWriteCase[] = [
  {
    action: 'product.create',
    body: { name: 'Pro' },
    expectedStatus: 201,
    method: 'POST',
    path: '/payable/products',
  },
  {
    action: 'product.update',
    body: { providerProductId: 'prod_fake', name: 'Pro v2' },
    expectedStatus: 200,
    method: 'PATCH',
    path: '/payable/products',
  },
  {
    action: 'product.activate',
    expectedStatus: 200,
    method: 'POST',
    path: '/payable/products/prod_fake/activate',
  },
  {
    action: 'product.archive',
    expectedStatus: 200,
    method: 'POST',
    path: '/payable/products/prod_fake/archive',
  },
  {
    action: 'price.create',
    body: {
      providerProductId: 'prod_fake',
      amount: { amount: 9900, currency: 'USD' },
      interval: 'month',
    },
    expectedStatus: 201,
    method: 'POST',
    path: '/payable/prices',
  },
  {
    action: 'price.activate',
    expectedStatus: 200,
    method: 'POST',
    path: '/payable/prices/price_fake/activate',
  },
  {
    action: 'price.archive',
    expectedStatus: 200,
    method: 'POST',
    path: '/payable/prices/price_fake/archive',
  },
];

export class TrackingCatalogIdempotencyStore extends InMemoryIdempotencyStore {
  readonly searchedKeys: string[] = [];

  override async find(key: string, tenantId?: string | null) {
    this.searchedKeys.push(key);
    return super.find(key, tenantId);
  }
}

export class HttpCatalogProvider extends FakeProvider {
  readonly operationContexts: OperationContext[] = [];
  productCreateCalls = 0;
  private blockedProductCreate?: Promise<void>;
  private notifyProductCreateStarted?: () => void;

  blockProductCreation(): { release: () => void; started: Promise<void> } {
    let release = () => {};
    let started = () => {};
    this.blockedProductCreate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const startedPromise = new Promise<void>((resolve) => {
      started = resolve;
    });
    this.notifyProductCreateStarted = started;
    return { release, started: startedPromise };
  }

  override async createProduct(
    input: CreateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.productCreateCalls += 1;
    this.recordContext(context);
    this.notifyProductCreateStarted?.();
    await this.blockedProductCreate;
    return {
      providerProductId: `prod_${this.productCreateCalls}`,
      name: input.name,
      description: input.description ?? null,
      active: input.active ?? true,
      metadata: input.metadata ?? null,
    };
  }

  override async updateProduct(
    input: UpdateProductInput,
    context?: OperationContext,
  ): Promise<ProductDTO> {
    this.recordContext(context);
    return super.updateProduct(input);
  }

  override async createPrice(
    input: CreatePriceInput,
    context?: OperationContext,
  ): Promise<PriceDTO> {
    this.recordContext(context);
    return super.createPrice(input);
  }

  override async setProductActive(
    id: string,
    active: boolean,
    context: OperationContext,
  ): Promise<ProductDTO> {
    this.recordContext(context);
    return super.setProductActive(id, active, context);
  }

  override async setPriceActive(
    id: string,
    active: boolean,
    context: OperationContext,
  ): Promise<PriceDTO> {
    this.recordContext(context);
    return super.setPriceActive(id, active, context);
  }

  private recordContext(context?: OperationContext): void {
    if (context) {
      this.operationContexts.push(context);
    }
  }
}

export function createCatalogHttpPayable(
  provider: HttpCatalogProvider,
  store: TrackingCatalogIdempotencyStore,
) {
  return createPayable({
    providers: { stripe: provider },
    idempotency: { store },
  });
}

export function catalogKey(action: string): string {
  return `catalog-${action}-opaque,part`;
}

export function expectedStoredKey(action: CatalogPersistenceAction): Promise<string> {
  return deriveCatalogProviderKey({
    providerName: 'stripe',
    action,
    callerKey: catalogKey(action),
  });
}
