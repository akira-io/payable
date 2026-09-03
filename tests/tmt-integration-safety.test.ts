import { describe, expect, it } from 'vitest';
import {
  runWithSanitizedTmtErrors,
  sanitizeTmtEvidence,
  TmtResourceLedger,
} from './support/tmt-integration-safety';

describe('TMT integration evidence safety', () => {
  it('redacts secrets, emails, hosted URLs and provider resource identifiers recursively', () => {
    const evidence = sanitizeTmtEvidence(
      {
        message:
          'token-value for real.person@example.org at https://hosted.example/pay/secret-path',
        booking: { id: 8123, uuid: 'provider-uuid', payment_request: 'https://pay.example/a' },
        providerPaymentId: '9912',
        channelSecret: 'secret-value',
      },
      ['token-value', 'secret-value'],
    );

    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain('token-value');
    expect(serialized).not.toContain('secret-value');
    expect(serialized).not.toContain('real.person@example.org');
    expect(serialized).not.toContain('https://');
    expect(serialized).not.toContain('8123');
    expect(serialized).not.toContain('9912');
    expect(serialized).not.toContain('provider-uuid');
    expect(evidence).toEqual({
      message: '[redacted] for [email] at [url]',
      booking: {
        id: '[provider-resource-id]',
        uuid: '[provider-resource-id]',
        payment_request: '[url]',
      },
      providerPaymentId: '[provider-resource-id]',
      channelSecret: '[redacted]',
    });
  });

  it('rethrows network failures without unsafe provider response details', async () => {
    await expect(
      runWithSanitizedTmtErrors(async () => {
        throw {
          code: 'PROVIDER_RESOURCE_NOT_FOUND',
          context: {
            body: { id: 8123, email: 'real.person@example.org' },
            hostedUrl: 'https://hosted.example/resource/8123',
          },
        };
      }),
    ).rejects.toThrow(
      '{"code":"PROVIDER_RESOURCE_NOT_FOUND","context":{"body":{"id":"[provider-resource-id]","email":"[email]"},"hostedUrl":"[url]"}}',
    );
  });
});

describe('TMT integration cleanup ledger', () => {
  it('deletes only bookings registered by this run in reverse creation order', async () => {
    const ledger = new TmtResourceLedger();
    const deleted: number[] = [];
    ledger.trackBooking(41);
    ledger.trackBooking(42);

    await expect(
      ledger.cleanup(async (id) => {
        deleted.push(id);
      }),
    ).resolves.toEqual([]);
    expect(deleted).toEqual([42, 41]);

    await ledger.cleanup(async (id) => deleted.push(id));
    expect(deleted).toEqual([42, 41]);
  });

  it('rejects invalid booking IDs and sanitizes cleanup failures', async () => {
    const ledger = new TmtResourceLedger();
    expect(() => ledger.trackBooking(0)).toThrow('positive integer');
    ledger.trackBooking(8123);

    const failures = await ledger.cleanup(async () => {
      throw new Error('Failed for booking 8123 at https://hosted.example/booking/8123');
    });

    expect(failures).toEqual([
      { resource: 'booking', message: 'Failed for booking [provider-resource-id] at [url]' },
    ]);
    expect(JSON.stringify(failures)).not.toContain('8123');
  });
});
