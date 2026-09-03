import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { TrustMyTravelClient } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-client';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import type { TrustMyTravelChannelResponse } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-types';
import {
  assertTmtTestChannel,
  resolveTmtIntegrationConfig,
  type TmtIntegrationConfig,
} from './support/tmt-integration-config';
import { runWithSanitizedTmtErrors, TmtResourceLedger } from './support/tmt-integration-safety';

const resolution = resolveTmtIntegrationConfig(process.env);
const credentialed = resolution.kind === 'ready' ? describe : describe.skip;
const skipReason = resolution.kind === 'skip' ? resolution.reason : 'TMT integration configured';

describe('Trust My Travel Test integration activation', () => {
  const activationTest = resolution.kind === 'skip' ? it.skip : it;
  activationTest(skipReason, () => {
    expect(resolution.kind).toBe('ready');
  });
});

credentialed('Trust My Travel Test integration', () => {
  const ledger = new TmtResourceLedger();
  let config!: TmtIntegrationConfig;
  let currency!: string;
  let client!: TrustMyTravelClient;
  let provider!: TrustMyTravelProvider;
  let network!: <T>(operation: () => Promise<T>) => Promise<T>;

  beforeAll(async () => {
    if (resolution.kind !== 'ready') throw new Error(skipReason);
    config = resolution.config;
    network = (operation) =>
      runWithSanitizedTmtErrors(
        operation,
        [config.apiToken, config.channelSecret],
        ledger.trackedResourceIds(),
      );
    client = new TrustMyTravelClient(config);
    const channel = await network(() =>
      client.request<TrustMyTravelChannelResponse>(`/channels/${config.channelId}`, {
        method: 'GET',
      }),
    );
    const readiness = assertTmtTestChannel(channel, config.channelId);
    currency = readiness.currency;
    provider = new TrustMyTravelProvider({
      ...config,
      currency,
      environment: 'test',
    });
  });

  afterAll(async () => {
    if (!provider) return;
    const failures = await ledger.cleanup((id) => network(() => provider.bookings.delete(id)));
    expect(failures).toEqual([]);
  });

  it('passes Test-only readiness and booking CRUD', async () => {
    const runReference = `payable-integration-${randomUUID()}`;
    const booking = await network(() =>
      provider.bookings.create({
        firstname: 'Payable',
        surname: 'Integration',
        email: 'payable-integration@example.invalid',
        date: '2035-06-15',
        total: Money.of(1234, currency),
        countries: 'PT',
        reference: runReference,
      }),
    );
    ledger.trackBooking(booking.id);

    const found = await network(() => provider.bookings.find(booking.id));
    expect(found.id === booking.id).toBe(true);
    expect(found.channels === config.channelId).toBe(true);
    expect(found.currencies).toBe(currency);
    expect(found.reference).toBe(runReference);
    expect(found.total).toBe(1234);

    const updated = await network(() =>
      provider.bookings.update(booking.id, {
        content: 'Payable integration certification',
      }),
    );
    expect(updated.id === booking.id).toBe(true);
    expect(updated.content).toBe('Payable integration certification');
  });

  it('reuses a run-owned booking for checkout without exposing credentials', async () => {
    const booking = await network(() =>
      provider.bookings.create({
        firstname: 'Payable',
        surname: 'Checkout',
        email: 'payable-checkout@example.invalid',
        date: '2035-06-16',
        total: Money.of(2345, currency),
        countries: 'PT',
        reference: `payable-checkout-${randomUUID()}`,
      }),
    );
    ledger.trackBooking(booking.id);

    const createCheckout = () =>
      provider.createCheckoutSession(
        {
          providerCustomerId: '',
          mode: 'payment',
          lineItems: [],
          successUrl: '',
          cancelUrl: '',
          amount: Money.of(2345, currency),
          providerData: {
            bookingId: booking.id,
            modal: {
              payee_name: 'Payable Checkout',
              payee_email: 'payable-checkout@example.invalid',
              payee_address: '1 Test Street',
              payee_city: 'Lisbon',
              payee_postcode: '1000-001',
              payee_country: 'PT',
            },
          },
        },
        { correlationId: randomUUID() },
      );

    const first = await network(createCheckout);
    const second = await network(createCheckout);
    expect(first.id === String(booking.id)).toBe(true);
    expect(second.id === first.id).toBe(true);
    expect(first.html).toContain('"environment":"test"');
    expect(first.html).toMatch(/"booking_auth":"[a-f0-9]{64}\d{14}"/u);
    expect(first.html).not.toContain(config.apiToken);
    expect(first.html).not.toContain(config.channelSecret);
  });

  it('normalizes a real invalid-resource HTTP response', async () => {
    const message = await network(() =>
      client.request('/bookings/not-a-number', { method: 'GET' }),
    ).catch((error) => String(error));
    expect(message).toContain('PROVIDER_');
    expect(message).toContain('trust-my-travel');
    expect(message).not.toContain(config.apiToken);
    expect(message).not.toContain(config.channelSecret);
  });

  it.skip('callback confirmation requires a transaction created by this run', () => {});
  it.skip('non-terminal and expiry states require a run-owned Payment Modal transaction', () => {});
  it.skip('full and partial refunds require a completed run-owned transaction', () => {});
});
