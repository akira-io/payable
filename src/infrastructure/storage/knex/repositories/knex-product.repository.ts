import type { ProductRepository } from '../../../../domain/contracts/product-repository.contract';
import type { Product } from '../../../../domain/entities/product.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexProductRepository implements ProductRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Product> {
    return this.unsupported('create');
  }

  update(): Promise<Product> {
    return this.unsupported('update');
  }

  findById(): Promise<Product | null> {
    return this.unsupported('findById');
  }

  findByProviderId(): Promise<Product | null> {
    return this.unsupported('findByProviderId');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexProductRepository.${op} (Phase 3)`);
  }
}
