import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { isTreasuryWebhookCapable } from '../src/domain/contracts/treasury-provider.contract';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { StripeTreasuryProvider } from '../src/infrastructure/providers/stripe/stripe-treasury-provider';

const payload = JSON.stringify({ id: 'evt_treasury_1' });

function stripeEvent(type: string, account: string | null = 'acct_1'): Stripe.Event {
  return {
    id: 'evt_treasury_1',
    type,
    created: 1_725_000_000,
    ...(account ? { account } : {}),
    data: { object: { id: 'resource_1', object: 'treasury.resource' } },
  } as unknown as Stripe.Event;
}

function subject(event = stripeEvent('treasury.transaction.created')) {
  const constructEventAsync = vi.fn().mockResolvedValue(event);
  const client = { webhooks: { constructEventAsync } } as unknown as Stripe;
  const provider = new StripeTreasuryProvider(
    {
      secretKey: 'sk_test',
      connectedAccountId: 'acct_1',
      webhookSecret: 'whsec_treasury_test',
    },
    client,
  );
  return { provider, constructEventAsync };
}

describe('Stripe Treasury webhooks', () => {
  it('advertises the complete Treasury webhook capability', () => {
    const { provider } = subject();

    expect(provider.capabilities().has('webhooks')).toBe(true);
    expect(isTreasuryWebhookCapable(provider)).toBe(true);
  });

  it('verifies the exact payload and preserves event identity and time', async () => {
    const { provider, constructEventAsync } = subject();

    const result = await provider.verifyTreasuryWebhook({ payload, signature: 'stripe-signature' });

    expect(constructEventAsync).toHaveBeenCalledWith(
      payload,
      'stripe-signature',
      'whsec_treasury_test',
    );
    expect(result).toEqual({
      providerEventId: 'evt_treasury_1',
      type: 'treasury.transaction.created',
      normalizedType: 'treasury.transaction.created',
      occurredAt: new Date(1_725_000_000_000),
      data: { id: 'resource_1', object: 'treasury.resource' },
    });
  });

  it('normalizes invalid signatures', async () => {
    const { provider, constructEventAsync } = subject();
    constructEventAsync.mockRejectedValue(new Error('signature mismatch'));

    await expect(
      provider.verifyTreasuryWebhook({ payload, signature: 'bad-signature' }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('rejects Connect events from a different connected account', async () => {
    const { provider } = subject(stripeEvent('treasury.transaction.created', 'acct_other'));

    await expect(
      provider.verifyTreasuryWebhook({ payload, signature: 'stripe-signature' }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_WEBHOOK_ACCOUNT_MISMATCH',
      context: {
        provider: 'stripe-treasury',
        expectedAccountId: 'acct_1',
        actualAccountId: 'acct_other',
      },
    });
  });

  it('accepts accountless events delivered directly to the connected account endpoint', async () => {
    const { provider } = subject(stripeEvent('treasury.transaction.created', null));

    await expect(
      provider.verifyTreasuryWebhook({ payload, signature: 'stripe-signature' }),
    ).resolves.toMatchObject({ providerEventId: 'evt_treasury_1' });
  });

  it('reports missing webhook configuration without calling Stripe', async () => {
    const constructEventAsync = vi.fn();
    const client = { webhooks: { constructEventAsync } } as unknown as Stripe;
    const provider = new StripeTreasuryProvider(
      { secretKey: 'sk_test', connectedAccountId: 'acct_1' },
      client,
    );

    await expect(
      provider.verifyTreasuryWebhook({ payload, signature: 'signature' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_WEBHOOK_SECRET_REQUIRED' });
    expect(constructEventAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['treasury.financial_account.created', 'treasury.account.created'],
    ['treasury.financial_account.closed', 'treasury.account.closed'],
    ['treasury.financial_account.features_status_updated', 'treasury.account.updated'],
    ['treasury.transaction.created', 'treasury.transaction.created'],
    ['treasury.transaction.updated', 'treasury.transaction.updated'],
    ['treasury.outbound_payment.created', 'treasury.transfer.created'],
    ['treasury.outbound_payment.updated', 'treasury.transfer.updated'],
    ['treasury.outbound_transfer.created', 'treasury.transfer.created'],
    ['treasury.outbound_transfer.updated', 'treasury.transfer.updated'],
  ] as const)('maps %s to %s', async (stripeType, normalizedType) => {
    const { provider } = subject(stripeEvent(stripeType));

    const result = await provider.verifyTreasuryWebhook({ payload, signature: 'signature' });

    expect(result.normalizedType).toBe(normalizedType);
  });

  it('preserves unknown events without assigning a normalized type', async () => {
    const { provider } = subject(stripeEvent('treasury.future_resource.updated'));

    const result = await provider.verifyTreasuryWebhook({ payload, signature: 'signature' });

    expect(result.normalizedType).toBeNull();
    expect(result.type).toBe('treasury.future_resource.updated');
  });
});
