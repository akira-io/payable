import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import {
  isTerminalDeviceCapable,
  isTerminalPaymentCapable,
} from '../src/domain/contracts/terminal-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { StripeTerminalProvider } from '../src/infrastructure/providers/stripe/stripe-terminal-provider';
import {
  fakeStripeTerminal,
  stripeTerminalPaymentIntent,
  stripeTerminalReader,
} from './support/stripe-terminal';

const context = { correlationId: 'corr-1', idempotencyKey: 'terminal-idem-1' };

function provider(client: Stripe): StripeTerminalProvider {
  return new StripeTerminalProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Terminal provider', () => {
  it('advertises complete device and payment capabilities without exposing secrets', () => {
    const { client } = fakeStripeTerminal();
    const instance = provider(client);

    expect(instance.capabilities()).toEqual(new Set(['devices', 'payments']));
    expect(isTerminalDeviceCapable(instance)).toBe(true);
    expect(isTerminalPaymentCapable(instance)).toBe(true);
    const configured = new StripeTerminalProvider({ secretKey: 'sk_live_private' });
    expect(JSON.stringify(configured)).not.toContain('sk_live_private');
    expect(inspect(configured)).not.toContain('sk_live_private');
  });

  it('lists and retrieves readers with bounded location filtering', async () => {
    const { client, calls } = fakeStripeTerminal();
    const instance = provider(client);

    const devices = await instance.listTerminalDevices({ locationId: 'tml_1', limit: 150 });
    const retrieved = await instance.retrieveTerminalDevice('tmr_1');

    expect(calls.readersList).toHaveBeenCalledWith({ location: 'tml_1', limit: 100 });
    expect(calls.readersPage.autoPagingToArray).toHaveBeenCalledWith({ limit: 150 });
    expect(calls.readersRetrieve).toHaveBeenCalledWith('tmr_1');
    expect(devices.map((device) => device.status)).toEqual(['busy', 'offline']);
    expect(retrieved).toEqual({
      providerDeviceId: 'tmr_1',
      label: 'Front desk',
      locationId: 'tml_1',
      status: 'busy',
      serialNumber: 'S700-123',
      deviceType: 'stripe_s700',
    });
    expect(JSON.stringify(retrieved)).not.toContain('10.0.0.20');
  });

  it('creates and hands a card-present PaymentIntent to the reader', async () => {
    const { client, calls } = fakeStripeTerminal();

    const payment = await provider(client).createTerminalPayment(
      {
        providerDeviceId: 'tmr_1',
        amount: Money.of(2_500, 'EUR'),
        reference: 'sale-1',
      },
      context,
    );

    expect(calls.paymentIntentsCreate).toHaveBeenCalledWith(
      {
        amount: 2_500,
        currency: 'eur',
        capture_method: 'automatic',
        payment_method_types: ['card_present'],
        metadata: { payable_terminal_reader_id: 'tmr_1', reference: 'sale-1' },
      },
      { idempotencyKey: 'terminal-idem-1:stripe-terminal:payment-intent' },
    );
    expect(calls.readersProcessPaymentIntent).toHaveBeenCalledWith(
      'tmr_1',
      { payment_intent: 'pi_terminal_1' },
      { idempotencyKey: 'terminal-idem-1:stripe-terminal:reader-process' },
    );
    expect(payment).toMatchObject({
      providerTerminalPaymentId: 'v1:tmr_1:pi_terminal_1',
      providerPaymentId: 'pi_terminal_1',
      providerDeviceId: 'tmr_1',
      status: 'in_progress',
    });
    expect(payment.amount.amount()).toBe(2_500);
  });

  it('returns distinct payment identities for sequential payments on one reader', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.paymentIntentsCreate
      .mockResolvedValueOnce(stripeTerminalPaymentIntent({ id: 'pi_terminal_1' }))
      .mockResolvedValueOnce(stripeTerminalPaymentIntent({ id: 'pi_terminal_2' }));

    const first = await provider(client).createTerminalPayment(
      { providerDeviceId: 'tmr_1', amount: Money.of(2_500, 'EUR') },
      context,
    );
    const second = await provider(client).createTerminalPayment(
      { providerDeviceId: 'tmr_1', amount: Money.of(3_500, 'EUR') },
      context,
    );

    expect(first.providerTerminalPaymentId).toBe('v1:tmr_1:pi_terminal_1');
    expect(second.providerTerminalPaymentId).toBe('v1:tmr_1:pi_terminal_2');
  });

  it('rejects manual capture before creating Stripe resources', async () => {
    const { client, calls } = fakeStripeTerminal();

    await expect(
      provider(client).createTerminalPayment(
        {
          providerDeviceId: 'tmr_1',
          amount: Money.of(5_000, 'USD'),
          captureMethod: 'manual',
        },
        context,
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_OPERATION_UNSUPPORTED',
      context: expect.objectContaining({ provider: 'stripe-terminal' }),
    });
    expect(calls.paymentIntentsCreate).not.toHaveBeenCalled();
    expect(calls.readersProcessPaymentIntent).not.toHaveBeenCalled();
  });

  it('retrieves reader action and PaymentIntent state', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.readersRetrieve.mockResolvedValue(
      stripeTerminalReader({
        action: {
          api_error: null,
          failure_code: null,
          failure_message: null,
          process_payment_intent: { payment_intent: 'pi_terminal_1' },
          status: 'succeeded',
          type: 'process_payment_intent',
        },
      }),
    );
    calls.paymentIntentsRetrieve.mockResolvedValue(
      stripeTerminalPaymentIntent({ status: 'succeeded', amount_received: 2_500 }),
    );

    const payment = await provider(client).retrieveTerminalPayment('v1:tmr_1:pi_terminal_1');

    expect(calls.readersRetrieve).toHaveBeenCalledWith('tmr_1');
    expect(calls.paymentIntentsRetrieve).toHaveBeenCalledWith('pi_terminal_1');
    expect(payment.providerTerminalPaymentId).toBe('v1:tmr_1:pi_terminal_1');
    expect(payment.status).toBe('succeeded');
  });

  it('reports authorized manual-capture PaymentIntents as pending', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.readersRetrieve.mockResolvedValue(
      stripeTerminalReader({
        action: {
          api_error: null,
          failure_code: null,
          failure_message: null,
          process_payment_intent: { payment_intent: 'pi_terminal_1' },
          status: 'succeeded',
          type: 'process_payment_intent',
        },
      }),
    );
    calls.paymentIntentsRetrieve.mockResolvedValue(
      stripeTerminalPaymentIntent({ capture_method: 'manual', status: 'requires_capture' }),
    );

    const payment = await provider(client).retrieveTerminalPayment('v1:tmr_1:pi_terminal_1');

    expect(payment.status).toBe('pending');
  });

  it('retrieves the intended payment while the reader processes a newer payment', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.readersRetrieve.mockResolvedValue(
      stripeTerminalReader({
        action: {
          api_error: null,
          failure_code: null,
          failure_message: null,
          process_payment_intent: { payment_intent: 'pi_terminal_2' },
          status: 'in_progress',
          type: 'process_payment_intent',
        },
      }),
    );
    calls.paymentIntentsRetrieve.mockResolvedValue(
      stripeTerminalPaymentIntent({ id: 'pi_terminal_1', status: 'succeeded' }),
    );

    const payment = await provider(client).retrieveTerminalPayment('v1:tmr_1:pi_terminal_1');

    expect(calls.paymentIntentsRetrieve).toHaveBeenCalledWith('pi_terminal_1');
    expect(payment.providerPaymentId).toBe('pi_terminal_1');
    expect(payment.status).toBe('succeeded');
  });

  it('rejects a payment identity whose PaymentIntent belongs to another reader', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.paymentIntentsRetrieve.mockResolvedValue(
      stripeTerminalPaymentIntent({ metadata: { payable_terminal_reader_id: 'tmr_2' } }),
    );

    await expect(
      provider(client).retrieveTerminalPayment('v1:tmr_1:pi_terminal_1'),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({
        provider: 'stripe-terminal',
        expectedReaderId: 'tmr_1',
        actualReaderId: 'tmr_2',
      }),
    });
  });

  it('cancels the exact PaymentIntent with operation idempotency', async () => {
    const { client, calls } = fakeStripeTerminal();

    const payment = await provider(client).cancelTerminalPayment('v1:tmr_1:pi_terminal_1', context);

    expect(calls.readersRetrieve).toHaveBeenCalledWith('tmr_1');
    expect(calls.paymentIntentsCancel).toHaveBeenCalledWith(
      'pi_terminal_1',
      {},
      { idempotencyKey: 'terminal-idem-1:stripe-terminal:payment-intent-cancel' },
    );
    expect(calls.readersCancelAction).not.toHaveBeenCalled();
    expect(payment.status).toBe('canceled');
  });

  it('does not cancel a newer reader action through a stale payment identity', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.readersRetrieve.mockResolvedValue(
      stripeTerminalReader({
        action: {
          api_error: null,
          failure_code: null,
          failure_message: null,
          process_payment_intent: { payment_intent: 'pi_terminal_2' },
          status: 'in_progress',
          type: 'process_payment_intent',
        },
      }),
    );

    await expect(
      provider(client).cancelTerminalPayment('v1:tmr_1:pi_terminal_1', context),
    ).resolves.toMatchObject({ providerPaymentId: 'pi_terminal_1', status: 'canceled' });
    expect(calls.paymentIntentsCancel).toHaveBeenCalledWith(
      'pi_terminal_1',
      {},
      expect.any(Object),
    );
    expect(calls.readersCancelAction).not.toHaveBeenCalled();
  });

  it('rejects legacy reader-only payment identities', async () => {
    const { client, calls } = fakeStripeTerminal();

    await expect(provider(client).retrieveTerminalPayment('tmr_1')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-terminal' }),
    });
    expect(calls.readersRetrieve).not.toHaveBeenCalled();
  });

  it('normalizes Stripe Terminal errors', async () => {
    const { client, calls } = fakeStripeTerminal();
    calls.readersRetrieve.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      code: 'terminal_reader_offline',
      message: 'Reader offline',
    });

    await expect(provider(client).retrieveTerminalDevice('offline')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-terminal' }),
    });
  });
});
