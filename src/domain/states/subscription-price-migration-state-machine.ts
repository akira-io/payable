import type { SubscriptionPriceMigrationStatus } from '../value-objects/subscription-price-migration-status';
import { applyTransition, canTransition, type TransitionMap } from './transition';

export type SubscriptionPriceMigrationEvent =
  | 'schedule'
  | 'start'
  | 'apply'
  | 'confirm_pending_renewal'
  | 'fail'
  | 'require_reconciliation'
  | 'resolve_applied'
  | 'resolve_pending_renewal'
  | 'resolve_not_applied'
  | 'settle'
  | 'retry'
  | 'cancel';

const MAP: TransitionMap<SubscriptionPriceMigrationStatus, SubscriptionPriceMigrationEvent> = {
  previewed: { schedule: 'scheduled', start: 'executing', cancel: 'cancelled' },
  scheduled: { start: 'executing', cancel: 'cancelled' },
  executing: {
    apply: 'applied',
    confirm_pending_renewal: 'pending_renewal',
    fail: 'failed',
    require_reconciliation: 'reconciliation_required',
  },
  pending_renewal: { settle: 'applied' },
  applied: {},
  failed: { retry: 'executing', cancel: 'cancelled' },
  reconciliation_required: {
    resolve_applied: 'applied',
    resolve_pending_renewal: 'pending_renewal',
    resolve_not_applied: 'failed',
  },
  cancelled: {},
};

export function canTransitionSubscriptionPriceMigrationStatus(
  from: SubscriptionPriceMigrationStatus,
  to: SubscriptionPriceMigrationStatus,
): boolean {
  return Object.values(MAP[from] ?? {}).includes(to);
}

export class SubscriptionPriceMigrationStateMachine {
  constructor(private state: SubscriptionPriceMigrationStatus = 'previewed') {}

  current(): SubscriptionPriceMigrationStatus {
    return this.state;
  }

  can(event: SubscriptionPriceMigrationEvent): boolean {
    return canTransition(MAP, this.state, event);
  }

  private to(event: SubscriptionPriceMigrationEvent): this {
    this.state = applyTransition('subscription_price_migration', MAP, this.state, event);
    return this;
  }

  schedule(): this {
    return this.to('schedule');
  }

  start(): this {
    return this.to('start');
  }

  apply(): this {
    return this.to('apply');
  }

  confirmPendingRenewal(): this {
    return this.to('confirm_pending_renewal');
  }

  fail(): this {
    return this.to('fail');
  }

  requireReconciliation(): this {
    return this.to('require_reconciliation');
  }

  resolveApplied(): this {
    return this.to('resolve_applied');
  }

  resolvePendingRenewal(): this {
    return this.to('resolve_pending_renewal');
  }

  resolveNotApplied(): this {
    return this.to('resolve_not_applied');
  }

  settle(): this {
    return this.to('settle');
  }

  retry(): this {
    return this.to('retry');
  }

  cancel(): this {
    return this.to('cancel');
  }
}
