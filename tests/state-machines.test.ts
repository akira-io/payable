import { describe, expect, it } from 'vitest';
import { InvalidStateTransitionError } from '../src/domain/errors/invalid-state-transition.error';
import { InvoiceStateMachine } from '../src/domain/states/invoice-state-machine';
import { PaymentStateMachine } from '../src/domain/states/payment-state-machine';
import { RefundStateMachine } from '../src/domain/states/refund-state-machine';
import { SubscriptionStateMachine } from '../src/domain/states/subscription-state-machine';

describe('SubscriptionStateMachine', () => {
  it('walks the trial-to-active-to-canceled path', () => {
    const machine = new SubscriptionStateMachine('incomplete');
    expect(machine.startTrial().current()).toBe('trialing');
    expect(machine.activate().current()).toBe('active');
    expect(machine.cancel().current()).toBe('canceled');
  });

  it('resumes from the grace period', () => {
    expect(new SubscriptionStateMachine('canceled').resume().current()).toBe('active');
  });

  it('throws on an invalid transition', () => {
    expect(() => new SubscriptionStateMachine('canceled').activate()).toThrow(
      InvalidStateTransitionError,
    );
  });

  it('reports whether a transition is allowed', () => {
    expect(new SubscriptionStateMachine('active').can('cancel')).toBe(true);
    expect(new SubscriptionStateMachine('active').can('start_trial')).toBe(false);
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
});

describe('PaymentStateMachine', () => {
  it('processes and succeeds', () => {
    const machine = new PaymentStateMachine('pending');
    expect(machine.process().current()).toBe('processing');
    expect(machine.succeed().current()).toBe('succeeded');
    expect(machine.refund().current()).toBe('refunded');
  });

  it('rejects refunding a pending payment', () => {
    expect(() => new PaymentStateMachine('pending').refund()).toThrow(InvalidStateTransitionError);
  });
});

describe('RefundStateMachine', () => {
  it('succeeds from pending', () => {
    expect(new RefundStateMachine('pending').succeed().current()).toBe('succeeded');
  });

  it('cannot transition out of a terminal state', () => {
    expect(() => new RefundStateMachine('succeeded').fail()).toThrow(InvalidStateTransitionError);
  });
});
