import type { CheckoutMode, CheckoutSessionDTO } from '../../domain/dtos/checkout.dto';
import { PayableError } from '../../domain/errors/payable-error';

export interface CheckoutRequest {
  successUrl: string;
  cancelUrl: string;
}

export class CheckoutBuilder {
  private readonly state: {
    mode: CheckoutMode;
    lineItems: { priceId: string; quantity: number }[];
  } = { mode: 'subscription', lineItems: [] };

  mode(mode: CheckoutMode): this {
    this.state.mode = mode;
    return this;
  }

  addPrice(priceId: string, quantity = 1): this {
    this.state.lineItems.push({ priceId, quantity });
    return this;
  }

  // TODO: Phase 5 - build checkout via CreateCheckoutSessionPipeline.
  async create(request: CheckoutRequest): Promise<CheckoutSessionDTO> {
    throw PayableError.notImplemented(
      `CheckoutBuilder.create (${this.state.mode} -> ${request.successUrl})`,
    );
  }
}
