import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../src/domain/errors/invalid-state-transition.error';
import { InvoiceStateMachine } from '../src/domain/states/invoice-state-machine';
import { PaymentStateMachine } from '../src/domain/states/payment-state-machine';
import {
  RefundStateMachine,
  resolveInitialRefundStatus,
} from '../src/domain/states/refund-state-machine';
import {
  reconcileSubscriptionStatus,
  SubscriptionStateMachine,
} from '../src/domain/states/subscription-state-machine';

describe('SubscriptionStateMachine', () => {
  it('walks the trial-to-active-to-canceled path', () => {
    const machine = new SubscriptionStateMachine('incomplete');
    expect(machine.startTrial().current()).toBe('trialing');
    expect(machine.activate().current()).toBe('active');
    expect(machine.cancel().current()).toBe('canceled');
  });

  it('resumes from a paused subscription', () => {
    expect(new SubscriptionStateMachine('paused').resume().current()).toBe('active');
  });

  it('moves a failed trial to past_due', () => {
    expect(new SubscriptionStateMachine('trialing').markPastDue().current()).toBe('past_due');
  });

  it('covers the provider dunning edges active to unpaid and trialing to unpaid', () => {
    expect(new SubscriptionStateMachine('active').markUnpaid().current()).toBe('unpaid');
    expect(new SubscriptionStateMachine('trialing').markUnpaid().current()).toBe('unpaid');
  });

  it('only lets a paused subscription resume or cancel', () => {
    expect(new SubscriptionStateMachine('paused').can('resume')).toBe(true);
    expect(new SubscriptionStateMachine('paused').can('cancel')).toBe(true);
    expect(new SubscriptionStateMachine('paused').can('mark_past_due')).toBe(false);
    expect(() => new SubscriptionStateMachine('paused').markPastDue()).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('treats canceled as terminal', () => {
    expect(() => new SubscriptionStateMachine('canceled').resume()).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => new SubscriptionStateMachine('canceled').activate()).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('reports whether a transition is allowed', () => {
    expect(new SubscriptionStateMachine('active').can('cancel')).toBe(true);
    expect(new SubscriptionStateMachine('active').can('start_trial')).toBe(false);
  });

  it('reconciles a provider status only through a legal transition', () => {
    expect(reconcileSubscriptionStatus('active', 'canceled')).toEqual({
      status: 'canceled',
      applied: true,
      event: 'cancel',
    });
    expect(reconcileSubscriptionStatus('paused', 'active')).toEqual({
      status: 'active',
      applied: true,
      event: 'resume',
    });
  });

  it('keeps the current status when the provider status is an illegal transition', () => {
    expect(reconcileSubscriptionStatus('canceled', 'active')).toEqual({
      status: 'canceled',
      applied: false,
      event: null,
    });
    expect(reconcileSubscriptionStatus('canceled', 'incomplete')).toEqual({
      status: 'canceled',
      applied: false,
      event: null,
    });
  });

  it('maps each reconcilable target to a single deterministic event', () => {
    expect(reconcileSubscriptionStatus('active', 'past_due').event).toBe('mark_past_due');
    expect(reconcileSubscriptionStatus('active', 'unpaid').event).toBe('mark_unpaid');
    expect(reconcileSubscriptionStatus('active', 'paused').event).toBe('pause');
    expect(reconcileSubscriptionStatus('trialing', 'active').event).toBe('activate');
    expect(reconcileSubscriptionStatus('past_due', 'active').event).toBe('activate');
  });

  it('treats an unchanged provider status as applied without an event', () => {
    expect(reconcileSubscriptionStatus('active', 'active')).toEqual({
      status: 'active',
      applied: true,
      event: null,
    });
  });
});

describe('InvoiceStateMachine', () => {
  it('finalizes then pays', () => {
    const machine = new InvoiceStateMachine('draft');
    expect(machine.finalize().current()).toBe('open');
    expect(machine.pay().current()).toBe('paid');
  });

  it('rejects paying a draft invoice', () => {
    expect(() => new InvoiceStateMachine('draft').pay()).toThrow(InvalidStateTransitionError);
  });

  it('voids an uncollectible invoice', () => {
    expect(new InvoiceStateMachine('uncollectible').voidInvoice().current()).toBe('void');
  });
});

describe('PaymentStateMachine', () => {
  it('processes and succeeds', () => {
    const machine = new PaymentStateMachine('pending');
    expect(machine.process().current()).toBe('processing');
    expect(machine.succeed().current()).toBe('succeeded');
    expect(machine.refund().current()).toBe('refunded');
  });

  it('cancels an in-flight payment', () => {
    expect(new PaymentStateMachine('processing').cancel().current()).toBe('canceled');
  });

  it('rejects refunding a pending payment', () => {
    expect(() => new PaymentStateMachine('pending').refund()).toThrow(InvalidStateTransitionError);
  });

  it('moves through partial refunds to a full refund', () => {
    const machine = new PaymentStateMachine('succeeded');
    expect(machine.partiallyRefund().current()).toBe('partially_refunded');
    expect(machine.partiallyRefund().current()).toBe('partially_refunded');
    expect(machine.refund().current()).toBe('refunded');
  });

  it('treats refunded as terminal', () => {
    expect(() => new PaymentStateMachine('refunded').partiallyRefund()).toThrow(
      InvalidStateTransitionError,
    );
    expect(() => new PaymentStateMachine('refunded').refund()).toThrow(InvalidStateTransitionError);
    expect(new PaymentStateMachine('partially_refunded').can('refund')).toBe(true);
  });
});

describe('RefundStateMachine', () => {
  it('succeeds from pending', () => {
    expect(new RefundStateMachine('pending').succeed().current()).toBe('succeeded');
  });

  it('cannot transition out of a terminal state', () => {
    expect(() => new RefundStateMachine('succeeded').fail()).toThrow(InvalidStateTransitionError);
  });

  it('resolves and validates an initial refund status', () => {
    expect(resolveInitialRefundStatus('pending')).toBe('pending');
    expect(resolveInitialRefundStatus('succeeded')).toBe('succeeded');
    expect(resolveInitialRefundStatus('failed')).toBe('failed');
    expect(resolveInitialRefundStatus('canceled')).toBe('canceled');
    expect(() => resolveInitialRefundStatus('garbage')).toThrow(InvalidStateTransitionError);
  });
});
