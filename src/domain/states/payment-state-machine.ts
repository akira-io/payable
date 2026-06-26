import type { PaymentStatus } from '../value-objects/payment-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type PaymentEvent =
  | 'process'
  | 'succeed'
  | 'fail'
  | 'cancel'
  | 'refund'
  | 'partially_refund';

const MAP: TransitionMap<PaymentStatus, PaymentEvent> = {
  pending: { process: 'processing', succeed: 'succeeded', fail: 'failed', cancel: 'canceled' },
  processing: { succeed: 'succeeded', fail: 'failed', cancel: 'canceled' },
  succeeded: { refund: 'refunded', partially_refund: 'partially_refunded' },
  partially_refunded: { refund: 'refunded', partially_refund: 'partially_refunded' },
};

const EVENT_BY_TARGET: Partial<Record<PaymentStatus, PaymentEvent>> = {
  processing: 'process',
  succeeded: 'succeed',
  failed: 'fail',
  canceled: 'cancel',
  refunded: 'refund',
  partially_refunded: 'partially_refund',
};

export class PaymentStateMachine {
  constructor(private state: PaymentStatus = 'pending') {}

  current(): PaymentStatus {
    return this.state;
  }

  can(event: PaymentEvent): boolean {
    return canTransition(MAP, this.state, event);
  }

  tryTransitionTo(target: PaymentStatus): boolean {
    if (this.state === target) {
      return false;
    }
    const event = EVENT_BY_TARGET[target];
    if (!event || !this.can(event)) {
      return false;
    }
    this.to(event);
    return true;
  }

  private to(event: PaymentEvent): this {
    this.state = applyTransition('payment', MAP, this.state, event);
    return this;
  }

  process(): this {
    return this.to('process');
  }

  succeed(): this {
    return this.to('succeed');
  }

  fail(): this {
    return this.to('fail');
  }

  cancel(): this {
    return this.to('cancel');
  }

  refund(): this {
    return this.to('refund');
  }

  partiallyRefund(): this {
    return this.to('partially_refund');
  }
}
