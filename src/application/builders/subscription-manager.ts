import type { SubscriptionDTO } from '../../domain/dtos/subscription.dto';
import { PayableError } from '../../domain/errors/payable-error';
import type { Billable } from './billable';

export class SubscriptionManager {
  private readonly state: { billable: Billable; name: string };

  constructor(billable: Billable, name: string) {
    this.state = { billable, name };
  }

  // TODO: Phase 9 - swap to a different price.
  async swap(priceId: string): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(
      `SubscriptionManager.swap (${this.state.name} -> ${priceId})`,
    );
  }

  // TODO: Phase 9 - cancel at period end (grace period).
  async cancel(): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(`SubscriptionManager.cancel (${this.state.name})`);
  }

  // TODO: Phase 9 - cancel immediately.
  async cancelNow(): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(`SubscriptionManager.cancelNow (${this.state.name})`);
  }

  // TODO: Phase 9 - resume during the grace period.
  async resume(): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(`SubscriptionManager.resume (${this.state.name})`);
  }

  // TODO: Phase 9 - update seat quantity.
  async updateQuantity(quantity: number): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(
      `SubscriptionManager.updateQuantity (${this.state.name} -> ${quantity})`,
    );
  }
}
