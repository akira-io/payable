import { inspect } from 'node:util';
import type Stripe from 'stripe';
import { describe, expect, it, vi } from 'vitest';
import { isIdentityVerificationCapable } from '../src/domain/contracts/identity-provider.contract';
import { StripeIdentityProvider } from '../src/infrastructure/providers/stripe/stripe-identity-provider';

const context = { correlationId: 'corr-1', idempotencyKey: 'identity-idem-1' };

function verificationSession(
  values: Partial<Stripe.Identity.VerificationSession> = {},
): Stripe.Identity.VerificationSession {
  return {
    id: 'vs_1',
    object: 'identity.verification_session',
    client_reference_id: 'subject-1',
    client_secret: 'vs_secret_1',
    created: 1_783_929_600,
    last_error: null,
    last_verification_report: null,
    livemode: false,
    metadata: { reference: 'subject-1' },
    options: { document: { require_matching_selfie: true, require_id_number: true } },
    redaction: null,
    related_customer: null,
    related_customer_account: null,
    status: 'requires_input',
    type: 'document',
    url: 'https://verify.stripe.com/start/1',
    ...values,
  };
}

function fakeStripeIdentity() {
  const create = vi.fn().mockResolvedValue(verificationSession());
  const retrieve = vi.fn().mockResolvedValue(verificationSession());
  const cancel = vi
    .fn()
    .mockResolvedValue(verificationSession({ status: 'canceled', client_secret: null, url: null }));
  const redact = vi.fn().mockResolvedValue(
    verificationSession({
      status: 'canceled',
      client_secret: null,
      url: null,
      redaction: { status: 'processing' },
    }),
  );
  const client = { identity: { verificationSessions: { create, retrieve, cancel, redact } } };
  return { client: client as unknown as Stripe, calls: { create, retrieve, cancel, redact } };
}

function provider(client: Stripe): StripeIdentityProvider {
  return new StripeIdentityProvider({ secretKey: 'sk_test' }, client);
}

describe('Stripe Identity provider', () => {
  it('advertises verification sessions without exposing credentials', () => {
    const { client } = fakeStripeIdentity();
    const instance = provider(client);
    const configured = new StripeIdentityProvider({ secretKey: 'sk_live_private' });

    expect(instance.capabilities()).toEqual(new Set(['verificationSessions']));
    expect(isIdentityVerificationCapable(instance)).toBe(true);
    expect(JSON.stringify(configured)).not.toContain('sk_live_private');
    expect(inspect(configured)).not.toContain('sk_live_private');
  });

  it('creates a document session with selfie and ID-number checks', async () => {
    const { client, calls } = fakeStripeIdentity();

    const result = await provider(client).createIdentityVerification(
      {
        reference: 'subject-1',
        checks: ['document', 'selfie', 'id_number'],
        returnUrl: 'https://example.com/identity/return',
      },
      context,
    );

    expect(calls.create).toHaveBeenCalledWith(
      {
        type: 'document',
        client_reference_id: 'subject-1',
        metadata: { reference: 'subject-1' },
        return_url: 'https://example.com/identity/return',
        options: { document: { require_matching_selfie: true, require_id_number: true } },
      },
      { idempotencyKey: 'identity-idem-1' },
    );
    expect(result).toMatchObject({
      providerVerificationId: 'vs_1',
      reference: 'subject-1',
      checks: ['document', 'selfie', 'id_number'],
      status: 'requires_input',
    });
  });

  it('creates a standalone ID-number verification', async () => {
    const { client, calls } = fakeStripeIdentity();
    calls.create.mockResolvedValue(
      verificationSession({ type: 'id_number', options: { id_number: {} } }),
    );

    const result = await provider(client).createIdentityVerification(
      { reference: 'subject-2', checks: ['id_number'] },
      context,
    );

    expect(calls.create).toHaveBeenCalledWith(
      {
        type: 'id_number',
        client_reference_id: 'subject-2',
        metadata: { reference: 'subject-2' },
        return_url: undefined,
        options: undefined,
      },
      { idempotencyKey: 'identity-idem-1' },
    );
    expect(result.checks).toEqual(['id_number']);
  });

  it.each([
    [[]],
    [['selfie']],
    [['address']],
    [['phone']],
    [['selfie', 'id_number']],
  ] as const)('rejects unsupported check combination %j before Stripe', async (checks) => {
    const { client, calls } = fakeStripeIdentity();

    await expect(
      provider(client).createIdentityVerification(
        { reference: 'subject-1', checks: [...checks] },
        context,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_OPERATION_UNSUPPORTED' });
    expect(calls.create).not.toHaveBeenCalled();
  });

  it('retrieves only the privacy-minimized verification result', async () => {
    const { client, calls } = fakeStripeIdentity();
    calls.retrieve.mockResolvedValue(
      verificationSession({
        status: 'verified',
        verified_outputs: {
          address: null,
          email: 'private@example.com',
          first_name: 'Private',
          id_number_type: 'us_ssn',
          last_name: 'Person',
          phone: '+352000000',
        },
        last_verification_report: 'vr_private',
        provided_details: { email: 'private@example.com' },
      }),
    );

    const result = await provider(client).retrieveIdentityVerification('vs/private');
    const serialized = JSON.stringify(result);

    expect(calls.retrieve).toHaveBeenCalledWith('vs/private');
    expect(result).not.toHaveProperty('verifiedOutputs');
    expect(result).not.toHaveProperty('last_verification_report');
    expect(serialized).not.toContain('private@example.com');
    expect(serialized).not.toContain('vr_private');
    expect(result.status).toBe('verified');
    expect(result.verifiedAt).toBeNull();
  });

  it.each([
    ['requires_input', null, 'requires_input'],
    ['processing', null, 'processing'],
    ['verified', null, 'verified'],
    ['canceled', null, 'canceled'],
    ['canceled', 'processing', 'processing'],
    ['canceled', 'validated', 'processing'],
    ['canceled', 'redacted', 'redacted'],
  ] as const)('maps status %s and redaction %s to %s', async (status, redaction, expected) => {
    const { client, calls } = fakeStripeIdentity();
    calls.retrieve.mockResolvedValue(
      verificationSession({
        status,
        redaction: redaction ? { status: redaction } : null,
      }),
    );

    const result = await provider(client).retrieveIdentityVerification('vs_1');

    expect(result.status).toBe(expected);
  });

  it('cancels and redacts sessions with idempotency', async () => {
    const { client, calls } = fakeStripeIdentity();
    const instance = provider(client);

    const canceled = await instance.cancelIdentityVerification('vs_1', context);
    const redacting = await instance.redactIdentityVerification('vs_1', context);

    expect(calls.cancel).toHaveBeenCalledWith('vs_1', {}, { idempotencyKey: 'identity-idem-1' });
    expect(calls.redact).toHaveBeenCalledWith('vs_1', {}, { idempotencyKey: 'identity-idem-1' });
    expect(canceled.status).toBe('canceled');
    expect(redacting.status).toBe('processing');
  });

  it('normalizes Stripe Identity errors', async () => {
    const { client, calls } = fakeStripeIdentity();
    calls.retrieve.mockRejectedValue({
      type: 'StripeInvalidRequestError',
      code: 'resource_missing',
      message: 'Verification session missing',
    });

    await expect(provider(client).retrieveIdentityVerification('missing')).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
      context: expect.objectContaining({ provider: 'stripe-identity' }),
    });
  });
});
