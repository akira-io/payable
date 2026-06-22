import type { SubscriptionRepository } from '../../../../domain/contracts/subscription-repository.contract';
import type { Subscription } from '../../../../domain/entities/subscription.entity';
import { PayableError } from '../../../../domain/errors/payable-error';

// TODO: Phase 3
export class KnexSubscriptionRepository implements SubscriptionRepository {
  constructor(protected readonly connection: unknown) {}

  create(): Promise<Subscription> {
    return this.unsupported('create');
  }

  update(): Promise<Subscription> {
    return this.unsupported('update');
  }

  findById(): Promise<Subscription | null> {
    return this.unsupported('findById');
  }

  findByName(): Promise<Subscription | null> {
    return this.unsupported('findByName');
  }

  findByProviderId(): Promise<Subscription | null> {
    return this.unsupported('findByProviderId');
  }

  listByCustomer(): Promise<Subscription[]> {
    return this.unsupported('listByCustomer');
  }

  private unsupported(op: string): never {
    throw PayableError.notImplemented(`KnexSubscriptionRepository.${op} (Phase 3)`);
  }
}
