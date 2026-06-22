import type { PriceRepository } from '../../../../domain/contracts/price-repository.contract';
import type { Price } from '../../../../domain/entities/price.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexPriceRepository implements PriceRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Price> {
    return this.unsupported('create');
  }

  update(): Promise<Price> {
    return this.unsupported('update');
  }

  findById(): Promise<Price | null> {
    return this.unsupported('findById');
  }

  findByProviderId(): Promise<Price | null> {
    return this.unsupported('findByProviderId');
  }

  listByProduct(): Promise<Price[]> {
    return this.unsupported('listByProduct');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexPriceRepository.${op} (Phase 3)`);
  }
}
