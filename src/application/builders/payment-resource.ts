import type { Payment } from '../../domain/entities/payment.entity';
import { PayableError } from '../../domain/errors/payable-error';
import {
  type CaptureAuthorizationRequest,
  SettleAuthorizationAction,
  type VoidAuthorizationRequest,
} from '../actions/payments/settle-authorization.action';
import type { LocalDependencies } from './local-dependencies';

export class PaymentResource {
  constructor(
    private readonly deps: LocalDependencies,
    private readonly id: string,
  ) {}

  capture(input: CaptureAuthorizationRequest): Promise<Payment> {
    return this.action().then((action) => action.capture(input));
  }

  void(input: VoidAuthorizationRequest): Promise<Payment> {
    return this.action().then((action) => action.void(input));
  }

  private async action(): Promise<SettleAuthorizationAction> {
    const payment = await this.deps.storage?.payments.findById(this.id, this.deps.tenantId);
    if (!payment?.provider || !this.deps.resolveProvider) {
      throw new PayableError(`Payment not found: ${this.id}`, { code: 'PAYMENT_NOT_FOUND' });
    }
    return new SettleAuthorizationAction(
      {
        ...this.deps,
        provider: this.deps.resolveProvider(payment.provider),
        providerName: payment.provider,
      },
      this.id,
    );
  }
}
