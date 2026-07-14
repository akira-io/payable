import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { StripeTerminalProvider } from '../src/infrastructure/providers/stripe/stripe-terminal-provider';
import { fakeStripeTerminal } from './support/stripe-terminal';

function subject() {
  const { client, calls } = fakeStripeTerminal();
  return { provider: new StripeTerminalProvider({ secretKey: 'sk_test' }, client), calls };
}

describe('Stripe Terminal idempotency', () => {
  it('derives stable bounded keys for each Stripe write operation', async () => {
    const { provider, calls } = subject();
    const context = { correlationId: 'corr-long', idempotencyKey: 'k'.repeat(512) };

    await provider.createTerminalPayment(
      { providerDeviceId: 'tmr_1', amount: Money.of(2_500, 'EUR') },
      context,
    );
    await provider.createTerminalPayment(
      { providerDeviceId: 'tmr_1', amount: Money.of(2_500, 'EUR') },
      context,
    );

    const createKeys = calls.paymentIntentsCreate.mock.calls.map((call) => call[1]?.idempotencyKey);
    const processKeys = calls.readersProcessPaymentIntent.mock.calls.map(
      (call) => call[2]?.idempotencyKey,
    );
    expect(createKeys[0]).toBe(createKeys[1]);
    expect(processKeys[0]).toBe(processKeys[1]);
    expect(createKeys[0]).not.toBe(processKeys[0]);
    expect(createKeys[0]?.length).toBeLessThanOrEqual(255);
    expect(processKeys[0]?.length).toBeLessThanOrEqual(255);
  });

  it('omits Stripe idempotency options when the context has no key', async () => {
    const { provider, calls } = subject();

    await provider.createTerminalPayment(
      { providerDeviceId: 'tmr_1', amount: Money.of(2_500, 'EUR') },
      { correlationId: 'corr-without-idempotency' },
    );

    expect(calls.paymentIntentsCreate).toHaveBeenCalledWith(expect.any(Object), undefined);
    expect(calls.readersProcessPaymentIntent).toHaveBeenCalledWith(
      'tmr_1',
      { payment_intent: 'pi_terminal_1' },
      undefined,
    );
  });
});
