import type { CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import type { SubscriptionDTO } from '../../domain/dtos/subscription.dto';
import { PayableError } from '../../domain/errors/payable-error';
import type { CheckoutRequest } from './checkout-builder';

export class SubscriptionBuilder {
  private readonly state: {
    name: string;
    priceId?: string;
    trialDays?: number;
    quantity: number;
    coupon?: string;
  };

  constructor(name: string) {
    this.state = { name, quantity: 1 };
  }

  price(priceId: string): this {
    this.state.priceId = priceId;
    return this;
  }

  trialDays(days: number): this {
    this.state.trialDays = days;
    return this;
  }

  quantity(quantity: number): this {
    this.state.quantity = quantity;
    return this;
  }

  coupon(code: string): this {
    this.state.coupon = code;
    return this;
  }

  // TODO: Phase 5 - start hosted checkout for this subscription.
  async checkout(request: CheckoutRequest): Promise<CheckoutSessionDTO> {
    throw PayableError.notImplemented(
      `SubscriptionBuilder.checkout (${this.state.name} -> ${request.successUrl})`,
    );
  }

  // TODO: Phase 9 - create the subscription directly via provider.
  async create(): Promise<SubscriptionDTO> {
    throw PayableError.notImplemented(`SubscriptionBuilder.create (${this.state.name})`);
  }
}
