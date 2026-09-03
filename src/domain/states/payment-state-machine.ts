import type { PaymentStatus } from '../value-objects/payment-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type PaymentEvent =
  | 'process'
  | 'authorize'
  | 'capture'
  | 'void'
  | 'succeed'
  | 'fail'
  | 'cancel'
  | 'refund'
  | 'partially_refund';

const MAP: TransitionMap<PaymentStatus, PaymentEvent> = {
  pending: {
    process: 'processing',
    authorize: 'authorized',
    succeed: 'succeeded',
    fail: 'failed',
    cancel: 'canceled',
  },
  processing: { authorize: 'authorized', succeed: 'succeeded', fail: 'failed', cancel: 'canceled' },
  authorized: { capture: 'succeeded', void: 'canceled', fail: 'failed' },
  failed: { process: 'processing', succeed: 'succeeded' },
  succeeded: { refund: 'refunded', partially_refund: 'partially_refunded' },
  partially_refunded: { refund: 'refunded', partially_refund: 'partially_refunded' },
};

const EVENT_BY_TARGET: Partial<Record<PaymentStatus, PaymentEvent>> = {
  processing: 'process',
  authorized: 'authorize',
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
    const event =
      this.state === 'authorized' && target === 'succeeded'
        ? 'capture'
        : this.state === 'authorized' && target === 'canceled'
          ? 'void'
          : EVENT_BY_TARGET[target];
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

  authorize(): this {
    return this.to('authorize');
  }

  capture(): this {
    return this.to('capture');
  }

  void(): this {
    return this.to('void');
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
