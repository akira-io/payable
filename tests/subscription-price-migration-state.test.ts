import { describe, expect, it } from 'vitest';
import type { Repositories } from '../src/domain/contracts/storage-driver.contract';
import type { SubscriptionPriceMigrationRepository } from '../src/domain/contracts/subscription-price-migration-repository.contract';
import { SubscriptionPriceMigrationStateMachine } from '../src/domain/states/subscription-price-migration-state-machine';
import type { SubscriptionPriceMigrationStatus } from '../src/domain/value-objects/subscription-price-migration-status';

type MigrationMethod =
  | 'schedule'
  | 'start'
  | 'apply'
  | 'confirmPendingRenewal'
  | 'fail'
  | 'requireReconciliation'
  | 'resolveApplied'
  | 'resolvePendingRenewal'
  | 'resolveNotApplied'
  | 'retry'
  | 'settle'
  | 'cancel';

const statuses: readonly SubscriptionPriceMigrationStatus[] = [
  'previewed',
  'scheduled',
  'executing',
  'pending_renewal',
  'applied',
  'failed',
  'reconciliation_required',
  'cancelled',
];

const allowedTransitions: Readonly<
  Record<
    SubscriptionPriceMigrationStatus,
    Partial<Record<MigrationMethod, SubscriptionPriceMigrationStatus>>
  >
> = {
  previewed: { schedule: 'scheduled', start: 'executing', cancel: 'cancelled' },
  scheduled: { start: 'executing', cancel: 'cancelled' },
  executing: {
    apply: 'applied',
    confirmPendingRenewal: 'pending_renewal',
    fail: 'failed',
    requireReconciliation: 'reconciliation_required',
  },
  pending_renewal: { settle: 'applied' },
  applied: {},
  failed: { retry: 'executing', cancel: 'cancelled' },
  reconciliation_required: {
    resolveApplied: 'applied',
    resolvePendingRenewal: 'pending_renewal',
    resolveNotApplied: 'failed',
  },
  cancelled: {},
};

const methods: readonly MigrationMethod[] = [
  'schedule',
  'start',
  'apply',
  'confirmPendingRenewal',
  'fail',
  'requireReconciliation',
  'resolveApplied',
  'resolvePendingRenewal',
  'resolveNotApplied',
  'retry',
  'settle',
  'cancel',
];

interface AllowedTransition {
  readonly from: SubscriptionPriceMigrationStatus;
  readonly method: MigrationMethod;
  readonly to: SubscriptionPriceMigrationStatus;
}

interface RejectedTransition {
  readonly from: SubscriptionPriceMigrationStatus;
  readonly method: MigrationMethod;
}

const allowedTransitionCases: readonly AllowedTransition[] = statuses.flatMap((from) =>
  Object.entries(allowedTransitions[from]).map(([method, to]) => ({
    from,
    method: method as MigrationMethod,
    to: to as SubscriptionPriceMigrationStatus,
  })),
);

const rejectedTransitionCases: readonly RejectedTransition[] = statuses.flatMap((from) =>
  methods
    .filter((method) => allowedTransitions[from][method] === undefined)
    .map((method) => ({ from, method })),
);

const migrationRepositoryIsRequired: Repositories extends {
  subscriptionPriceMigrations: SubscriptionPriceMigrationRepository;
}
  ? true
  : false = true;

describe('subscription price migration state machine', () => {
  it.each(allowedTransitionCases)('allows $from to become $to through $method', ({
    from,
    method,
    to,
  }) => {
    const machine = new SubscriptionPriceMigrationStateMachine(from);

    machine[method]();

    expect(machine.current()).toBe(to);
  });

  it.each(
    rejectedTransitionCases,
  )('rejects $from through $method when it is not an allowed transition', ({ from, method }) => {
    const machine = new SubscriptionPriceMigrationStateMachine(from);

    expect(() => machine[method]()).toThrowError(
      expect.objectContaining({
        code: 'INVALID_STATE_TRANSITION',
        context: expect.objectContaining({
          machine: 'subscription_price_migration',
          from,
        }),
      }),
    );
  });

  it.each([
    'applied',
    'reconciliation_required',
    'cancelled',
  ] as const)('treats %s as terminal for automatic execution', (status) => {
    const machine = new SubscriptionPriceMigrationStateMachine(status);

    expect(machine.can('start')).toBe(false);
    expect(machine.can('retry')).toBe(false);
    expect(machine.can('apply')).toBe(false);
  });

  it('requires the migration repository in storage repositories', () => {
    expect(migrationRepositoryIsRequired).toBe(true);
  });
});
