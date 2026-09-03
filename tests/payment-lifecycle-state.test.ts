import { describe, expect, it } from 'vitest';
import { PaymentStateMachine } from '../src/domain/states/payment-state-machine';
import { isPaymentStatus } from '../src/domain/value-objects/payment-status';

describe('payment authorization lifecycle', () => {
  it('recognizes authorized as a payment status', () => {
    expect(isPaymentStatus('authorized')).toBe(true);
  });

  it('captures an authorized payment', () => {
    expect(new PaymentStateMachine('authorized').capture().current()).toBe('succeeded');
  });

  it('voids an authorized payment', () => {
    expect(new PaymentStateMachine('authorized').void().current()).toBe('canceled');
  });

  it('maps asynchronous terminal reconciliation through lifecycle events', () => {
    const captured = new PaymentStateMachine('authorized');
    const voided = new PaymentStateMachine('authorized');

    expect(captured.tryTransitionTo('succeeded')).toBe(true);
    expect(captured.current()).toBe('succeeded');
    expect(voided.tryTransitionTo('canceled')).toBe(true);
    expect(voided.current()).toBe('canceled');
  });

  it('rejects capture after void', () => {
    expect(() => new PaymentStateMachine('canceled').capture()).toThrow(
      /Invalid payment transition/,
    );
  });
});
