import type { SubscriptionStatus } from '../value-objects/subscription-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type SubscriptionEvent =
  | 'start_trial'
  | 'activate'
  | 'mark_past_due'
  | 'mark_unpaid'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'expire';

const MAP: TransitionMap<SubscriptionStatus, SubscriptionEvent> = {
  incomplete: {
    start_trial: 'trialing',
    activate: 'active',
    expire: 'incomplete_expired',
    cancel: 'canceled',
  },
  trialing: {
    activate: 'active',
    mark_past_due: 'past_due',
    mark_unpaid: 'unpaid',
    pause: 'paused',
    cancel: 'canceled',
  },
  active: {
    mark_past_due: 'past_due',
    mark_unpaid: 'unpaid',
    pause: 'paused',
    cancel: 'canceled',
  },
  past_due: { activate: 'active', mark_unpaid: 'unpaid', cancel: 'canceled' },
  unpaid: { activate: 'active', cancel: 'canceled' },
  paused: { resume: 'active', mark_past_due: 'past_due', cancel: 'canceled' },
  canceled: {},
};

export class SubscriptionStateMachine {
  constructor(private state: SubscriptionStatus = 'incomplete') {}

  current(): SubscriptionStatus {
    return this.state;
  }

  can(event: SubscriptionEvent): boolean {
    return canTransition(MAP, this.state, event);
  }

  private to(event: SubscriptionEvent): this {
    this.state = applyTransition('subscription', MAP, this.state, event);
    return this;
  }

  startTrial(): this {
    return this.to('start_trial');
  }

  activate(): this {
    return this.to('activate');
  }

  markPastDue(): this {
    return this.to('mark_past_due');
  }

  markUnpaid(): this {
    return this.to('mark_unpaid');
  }

  pause(): this {
    return this.to('pause');
  }

  resume(): this {
    return this.to('resume');
  }

  cancel(): this {
    return this.to('cancel');
  }

  expire(): this {
    return this.to('expire');
  }
}
