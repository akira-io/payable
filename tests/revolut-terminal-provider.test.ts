import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import {
  isTerminalDeviceCapable,
  isTerminalPaymentCapable,
} from '../src/domain/contracts/terminal-provider.contract';
import { Money } from '../src/domain/value-objects/money';
import { RevolutTerminalProvider } from '../src/infrastructure/providers/revolut/revolut-terminal-provider';
import { fakeRevolutTerminalFetch, terminal, terminalIntent } from './support/revolut-terminal';

const context = { correlationId: 'corr-1', idempotencyKey: 'terminal-idem-1' };

function provider(fetch: typeof globalThis.fetch) {
  return new RevolutTerminalProvider({
    secretKey: 'merchant-secret',
    environment: 'sandbox',
    locationId: 'location-1',
    fetch,
  });
}

describe('Revolut Terminal provider', () => {
  it('advertises terminal capabilities without exposing credentials', () => {
    const { fetch } = fakeRevolutTerminalFetch();
    const instance = provider(fetch);

    expect(instance.capabilities()).toEqual(new Set(['devices', 'payments']));
    expect(isTerminalDeviceCapable(instance)).toBe(true);
    expect(isTerminalPaymentCapable(instance)).toBe(true);
    expect(JSON.stringify(instance)).not.toContain('merchant-secret');
    expect(inspect(instance)).not.toContain('merchant-secret');
  });

  it('lists and retrieves location-filtered POS terminals', async () => {
    const offline = { ...terminal, id: 'terminal-2', online: false };
    const { fetch, calls } = fakeRevolutTerminalFetch(
      { body: { terminals: [terminal, offline] } },
      { body: { terminals: [terminal, offline] } },
    );
    const instance = provider(fetch);

    const devices = await instance.listTerminalDevices({ limit: 1 });
    const retrieved = await instance.retrieveTerminalDevice('terminal-2');

    expect(devices).toEqual([
      {
        providerDeviceId: 'terminal-1',
        label: 'Counter one',
        locationId: 'location-1',
        status: 'online',
        serialNumber: 'RT-00123456',
        deviceType: 'newland_n950',
      },
    ]);
    expect(retrieved.status).toBe('offline');
    expect(calls.map((call) => call.url)).toEqual([
      'https://sandbox-merchant.revolut.com/api/terminals?operation_mode=pos&location_id=location-1',
      'https://sandbox-merchant.revolut.com/api/terminals?operation_mode=pos&location_id=location-1',
    ]);
    expect(calls[0]?.headers).toMatchObject({
      authorization: 'Bearer merchant-secret',
      'revolut-api-version': '2026-04-20',
    });
  });

  it('creates a POS order and pushes its payment intent', async () => {
    const { fetch, calls } = fakeRevolutTerminalFetch(
      { body: { terminals: [terminal] } },
      { body: { id: 'order-1' } },
      { body: terminalIntent },
    );

    const payment = await provider(fetch).createTerminalPayment(
      {
        providerDeviceId: 'terminal-1',
        amount: Money.of(2500, 'EUR'),
        reference: 'sale-1',
      },
      context,
    );

    expect(calls[1]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders',
      method: 'POST',
      body: {
        amount: 2500,
        currency: 'EUR',
        channel: 'pos',
        location_id: 'location-1',
        fulfilment_type: 'eat_in',
        capture_mode: 'manual',
        merchant_order_data: { reference: 'sale-1' },
        metadata: { pos_partner_name: 'Payable' },
      },
    });
    expect(calls[2]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/orders/order-1/payment-intents',
      method: 'POST',
      body: { amount: 2500, terminal_id: 'terminal-1' },
    });
    expect(calls[1]?.headers).not.toHaveProperty('idempotency-key');
    expect(calls[2]?.headers).not.toHaveProperty('idempotency-key');
    expect(payment).toMatchObject({
      providerTerminalPaymentId: 'intent-1',
      providerPaymentId: null,
      providerDeviceId: 'terminal-1',
      status: 'pending',
    });
    expect(payment.amount.amount()).toBe(2500);
  });

  it('retrieves final payment state after a completed intent', async () => {
    const completed = { ...terminalIntent, state: 'completed', payment_id: 'payment-1' };
    const { fetch, calls } = fakeRevolutTerminalFetch(
      { body: completed },
      {
        body: {
          id: 'payment-1',
          state: 'captured',
          amount: 2500,
          currency: 'EUR',
          created_at: terminalIntent.created_at,
          updated_at: '2026-07-14T09:02:00Z',
        },
      },
    );

    const payment = await provider(fetch).retrieveTerminalPayment('intent-1');

    expect(calls.map((call) => call.url)).toEqual([
      'https://sandbox-merchant.revolut.com/api/payment-intents/intent-1',
      'https://sandbox-merchant.revolut.com/api/payments/payment-1',
    ]);
    expect(payment).toMatchObject({ providerPaymentId: 'payment-1', status: 'succeeded' });
  });

  it.each([
    ['pending', 'pending'],
    ['processing', 'in_progress'],
    ['completed', 'in_progress'],
    ['failed', 'failed'],
    ['cancelled', 'canceled'],
    ['future_state', 'unknown'],
  ])('maps payment intent state %s to %s', async (state, expected) => {
    const { fetch } = fakeRevolutTerminalFetch({ body: { ...terminalIntent, state } });

    const payment = await provider(fetch).retrieveTerminalPayment('intent-1');

    expect(payment.status).toBe(expected);
  });

  it.each([
    ['authorised', 'in_progress'],
    ['declined', 'failed'],
    ['failed', 'failed'],
    ['cancelled', 'canceled'],
    ['future_state', 'unknown'],
  ])('maps final payment state %s to %s', async (state, expected) => {
    const completed = { ...terminalIntent, state: 'completed', payment_id: 'payment-1' };
    const { fetch } = fakeRevolutTerminalFetch(
      { body: completed },
      { body: { ...completed, id: 'payment-1', state } },
    );

    const payment = await provider(fetch).retrieveTerminalPayment('intent-1');

    expect(payment.status).toBe(expected);
  });

  it('cancels a pending intent without inventing idempotency support', async () => {
    const cancelled = { ...terminalIntent, state: 'cancelled' };
    const { fetch, calls } = fakeRevolutTerminalFetch({ body: cancelled });

    const payment = await provider(fetch).cancelTerminalPayment('intent/1', context);

    expect(calls[0]).toMatchObject({
      url: 'https://sandbox-merchant.revolut.com/api/payment-intents/intent%2F1/cancel',
      method: 'POST',
    });
    expect(calls[0]?.headers).not.toHaveProperty('idempotency-key');
    expect(payment.status).toBe('canceled');
  });

  it('rejects unsupported capture and offline terminals before writes', async () => {
    const { fetch, calls } = fakeRevolutTerminalFetch({
      body: { terminals: [{ ...terminal, online: false }] },
    });
    const instance = provider(fetch);

    await expect(
      instance.createTerminalPayment(
        {
          providerDeviceId: 'terminal-1',
          amount: Money.of(2500, 'EUR'),
          captureMethod: 'manual',
        },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
    expect(calls).toHaveLength(0);

    await expect(
      instance.createTerminalPayment(
        { providerDeviceId: 'terminal-1', amount: Money.of(2500, 'EUR') },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
    expect(calls).toHaveLength(1);
  });

  it('normalizes Merchant API errors under the terminal provider', async () => {
    const { fetch } = fakeRevolutTerminalFetch({
      status: 401,
      body: { code: 'unauthenticated', message: 'Invalid API key' },
    });

    await expect(provider(fetch).listTerminalDevices()).rejects.toMatchObject({
      code: 'PROVIDER_AUTH_FAILED',
      context: { provider: 'revolut-terminal', revolutCode: 'unauthenticated', status: 401 },
    });
  });
});
