import type { RefundStatus } from '../value-objects/refund-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type RefundEvent = 'succeed' | 'fail' | 'cancel';

const MAP: TransitionMap<RefundStatus, RefundEvent> = {
  pending: { succeed: 'succeeded', fail: 'failed', cancel: 'canceled' },
};

export class RefundStateMachine {
  constructor(private state: RefundStatus = 'pending') {}

  current(): RefundStatus {
    return this.state;
  }

  can(event: RefundEvent): boolean {
    return canTransition(MAP, this.state, event);
  }

  private to(event: RefundEvent): this {
    this.state = applyTransition('refund', MAP, this.state, event);
    return this;
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
}
