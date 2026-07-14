import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isTreasuryWebhookCapable } from '../src/domain/contracts/treasury-provider.contract';
import { InvalidWebhookSignatureError } from '../src/domain/errors/invalid-webhook-signature.error';
import { RevolutBusinessTreasuryProvider } from '../src/infrastructure/providers/revolut/revolut-business-treasury-provider';

const secret = 'wsk_business_test';

function subject() {
  return new RevolutBusinessTreasuryProvider({
    tokenProvider: { getAccessToken: () => 'business-token' },
    webhookSecret: secret,
  });
}

function eventPayload(event: string, timestamp = '2026-07-14T10:00:00.000Z'): string {
  return JSON.stringify({
    event,
    timestamp,
    data: { id: 'resource-1', request_id: 'request-1', new_state: 'completed' },
  });
}

function input(payload: string, signatureOverride?: string) {
  const timestamp = String(Date.now());
  const digest = createHmac('sha256', secret).update(`v1.${timestamp}.${payload}`).digest('hex');
  return {
    payload,
    signature: signatureOverride ?? `v1=${digest}`,
    headers: { 'Revolut-Request-Timestamp': timestamp },
  };
}

describe('Revolut Business Treasury webhooks', () => {
  it('advertises the complete Treasury webhook capability', () => {
    const provider = subject();

    expect(provider.capabilities().has('webhooks')).toBe(true);
    expect(isTreasuryWebhookCapable(provider)).toBe(true);
  });

  it.each([
    ['TransactionCreated', 'treasury.transaction.created'],
    ['TransactionStateChanged', 'treasury.transaction.updated'],
    ['PayoutLinkCreated', 'treasury.payout_link.created'],
    ['PayoutLinkStateChanged', 'treasury.payout_link.updated'],
  ] as const)('verifies and maps %s without assuming event order', async (type, normalizedType) => {
    const payload = eventPayload(type);

    await expect(subject().verifyTreasuryWebhook(input(payload))).resolves.toEqual({
      providerEventId: `revolut-business:${createHash('sha256').update(payload).digest('hex')}`,
      type,
      normalizedType,
      occurredAt: new Date('2026-07-14T10:00:00.000Z'),
      data: { id: 'resource-1', request_id: 'request-1', new_state: 'completed' },
    });
  });

  it('produces the same event identity for an exact redelivery', async () => {
    const payload = eventPayload('TransactionCreated');
    const provider = subject();

    const first = await provider.verifyTreasuryWebhook(input(payload));
    const repeated = await provider.verifyTreasuryWebhook(input(payload));

    expect(repeated.providerEventId).toBe(first.providerEventId);
  });

  it('accepts any matching v1 signature during secret rotation', async () => {
    const payload = eventPayload('TransactionCreated');
    const signed = input(payload);

    await expect(
      subject().verifyTreasuryWebhook({
        ...signed,
        signature: `v1=${'0'.repeat(64)},${signed.signature}`,
      }),
    ).resolves.toMatchObject({ type: 'TransactionCreated' });
  });

  it('preserves unknown verified events without inventing a normalized type', async () => {
    const payload = eventPayload('FutureBusinessEvent');

    await expect(subject().verifyTreasuryWebhook(input(payload))).resolves.toMatchObject({
      type: 'FutureBusinessEvent',
      normalizedType: null,
    });
  });

  it('rejects malformed signatures in constant-time comparison paths', async () => {
    const payload = eventPayload('TransactionCreated');

    await expect(
      subject().verifyTreasuryWebhook(input(payload, 'v1=not-a-valid-digest')),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('rejects invalid JSON after authenticating the exact raw payload', async () => {
    const payload = '{invalid';

    await expect(subject().verifyTreasuryWebhook(input(payload))).rejects.toMatchObject({
      code: 'PROVIDER_WEBHOOK_PAYLOAD_INVALID',
      context: { provider: 'revolut-business-treasury' },
    });
  });

  it('rejects stale delivery timestamps', async () => {
    const payload = eventPayload('TransactionCreated');
    const staleTimestamp = '1683650202360';
    const signature = `v1=${createHmac('sha256', secret)
      .update(`v1.${staleTimestamp}.${payload}`)
      .digest('hex')}`;

    await expect(
      subject().verifyTreasuryWebhook({
        payload,
        signature,
        headers: { 'Revolut-Request-Timestamp': staleTimestamp },
      }),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
  });

  it('reports missing webhook configuration without authenticating a payload', async () => {
    const provider = new RevolutBusinessTreasuryProvider({
      tokenProvider: { getAccessToken: () => 'business-token' },
    });

    await expect(
      provider.verifyTreasuryWebhook(input(eventPayload('TransactionCreated'))),
    ).rejects.toMatchObject({ code: 'PROVIDER_WEBHOOK_SECRET_REQUIRED' });
  });
});
