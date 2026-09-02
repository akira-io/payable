import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  type TmtBookingCreateInput,
  type TmtBookingResponse,
  TrustMyTravelBookings,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-bookings';
import type {
  TrustMyTravelRequest,
  TrustMyTravelRequestOptions,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-client';

interface RecordedRequest {
  path: string;
  options: TrustMyTravelRequestOptions;
}

const BOOKING: TmtBookingResponse = {
  id: 44,
  uuid: '018ca159-0fe8-7e30-bf44-5fb3703375ac',
  trust_id: '3-44',
  status: 'unpaid',
  firstname: 'John',
  surname: 'Smith',
  email: 'john@example.org',
  date: '2030-05-12',
  total: 9999,
  total_unpaid: 9999,
  currencies: 'EUR',
  countries: 'PT,ES',
  channels: 2452,
  transaction_ids: [],
};

function fakeRequest(...responses: unknown[]) {
  const requests: RecordedRequest[] = [];
  const request: TrustMyTravelRequest = async <T>(
    path: string,
    options: TrustMyTravelRequestOptions,
  ) => {
    requests.push({ path, options });
    return responses.shift() as T;
  };
  return { request, requests };
}

function createInput(): TmtBookingCreateInput {
  return {
    firstname: 'John',
    surname: 'Smith',
    email: 'john@example.org',
    date: '2030-05-12',
    total: Money.of(9999, 'EUR'),
    countries: 'PT,ES',
    reference: 'ORDER-42',
  };
}

describe('TrustMyTravelBookings', () => {
  it('creates a booking in the configured channel and base currency', async () => {
    const { request, requests } = fakeRequest(BOOKING);
    const bookings = new TrustMyTravelBookings(request, { channelId: 2452, currency: 'eur' });

    await expect(bookings.create(createInput())).resolves.toEqual(BOOKING);
    expect(requests).toEqual([
      {
        path: '/bookings',
        options: {
          method: 'POST',
          body: {
            firstname: 'John',
            surname: 'Smith',
            email: 'john@example.org',
            date: '2030-05-12',
            total: 9999,
            currencies: 'EUR',
            countries: 'PT,ES',
            channels: 2452,
            reference: 'ORDER-42',
          },
        },
      },
    ]);
  });

  it('reads, updates and deletes a booking through the injected request', async () => {
    const updated = { ...BOOKING, content: 'Updated trip' };
    const { request, requests } = fakeRequest(BOOKING, updated, null);
    const bookings = new TrustMyTravelBookings(request, { channelId: 2452, currency: 'EUR' });

    await expect(bookings.find(44)).resolves.toEqual(BOOKING);
    await expect(
      bookings.update(44, { content: 'Updated trip', paymentRequestUrl: true }),
    ).resolves.toEqual(updated);
    await expect(bookings.delete(44)).resolves.toBeUndefined();

    expect(requests).toEqual([
      { path: '/bookings/44', options: { method: 'GET' } },
      {
        path: '/bookings/44?payment_request_url=true',
        options: { method: 'PUT', body: { content: 'Updated trip' } },
      },
      { path: '/bookings/44', options: { method: 'DELETE' } },
    ]);
  });

  it('rejects a booking currency that differs from the channel base currency', async () => {
    const { request, requests } = fakeRequest();
    const bookings = new TrustMyTravelBookings(request, { channelId: 2452, currency: 'EUR' });

    await expect(
      bookings.create({ ...createInput(), total: Money.of(9999, 'USD') }),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TMT_BOOKING_CURRENCY_MISMATCH',
      context: {
        provider: 'trust-my-travel',
        currency: 'USD',
        channelCurrency: 'EUR',
      },
    });
    expect(requests).toHaveLength(0);
  });

  it.each([
    'content',
    'firstname',
    'surname',
    'email',
    'date',
    'date_start',
    'reference',
    'countries',
    'language',
  ] as const)('rejects an oversized %s field before the request', async (field) => {
    const { request, requests } = fakeRequest();
    const bookings = new TrustMyTravelBookings(request, { channelId: 2452, currency: 'EUR' });
    const input = { ...createInput(), [field]: 'x'.repeat(192) };

    await expect(bookings.create(input)).rejects.toMatchObject({
      code: 'PROVIDER_TMT_BOOKING_FIELD_TOO_LONG',
      context: { provider: 'trust-my-travel', field, maxLength: 191 },
    });
    expect(requests).toHaveLength(0);
  });
});
