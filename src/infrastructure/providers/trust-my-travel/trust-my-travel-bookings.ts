import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import type { Money } from '../../../domain/value-objects/money';
import { trustMyTravelAmount } from './trust-my-travel-amounts';
import type { TrustMyTravelRequest } from './trust-my-travel-client';
import type { TrustMyTravelLanguage } from './trust-my-travel-types';

const MAXIMUM_TEXT_LENGTH = 191;

interface TmtBookingFields {
  content?: string;
  firstname?: string;
  surname?: string;
  email?: string;
  date?: string;
  date_start?: string;
  pax?: number;
  reference?: string;
  countries?: string;
  language?: TrustMyTravelLanguage;
  suppliers?: number[];
}

export interface TmtBookingCreateInput extends TmtBookingFields {
  firstname: string;
  surname: string;
  email: string;
  date: string;
  total: Money;
  countries: string;
  paymentRequestUrl?: boolean;
}

export interface TmtBookingUpdateInput extends TmtBookingFields {
  total?: Money;
  paymentRequestUrl?: boolean;
}

export interface TmtBookingResponse {
  id: number;
  uuid: string;
  trust_id: string;
  status: string;
  content?: string;
  firstname: string;
  surname: string;
  email: string;
  date: string;
  date_start?: string;
  pax?: number;
  reference?: string;
  total: number;
  total_unpaid: number;
  currencies: string;
  countries: string;
  transaction_ids: number[];
  channels: number;
  language?: string;
  suppliers?: number[];
  _links?: {
    self?: Array<{ payment_request?: string }>;
  };
}

export interface TmtBookingChannel {
  channelId: number;
  currency: string;
}

export class TrustMyTravelBookings {
  private readonly channelCurrency: string;

  constructor(
    private readonly request: TrustMyTravelRequest,
    private readonly channel: TmtBookingChannel,
  ) {
    this.channelCurrency = CurrencyManager.normalize(channel.currency);
  }

  async create(input: TmtBookingCreateInput): Promise<TmtBookingResponse> {
    const { total, paymentRequestUrl, ...fields } = input;
    assertTextFieldLengths(fields);
    const booking = {
      ...fields,
      total: this.amount(total),
      currencies: this.channelCurrency,
      channels: this.channel.channelId,
    };
    return await this.request<TmtBookingResponse>(bookingPath(undefined, paymentRequestUrl), {
      method: 'POST',
      body: booking,
    });
  }

  find(id: number): Promise<TmtBookingResponse> {
    return this.request<TmtBookingResponse>(bookingPath(id), { method: 'GET' });
  }

  async update(id: number, input: TmtBookingUpdateInput): Promise<TmtBookingResponse> {
    const { total, paymentRequestUrl, ...fields } = input;
    assertTextFieldLengths(fields);
    const booking = {
      ...fields,
      ...(total === undefined ? {} : { total: this.amount(total) }),
    };
    return await this.request<TmtBookingResponse>(bookingPath(id, paymentRequestUrl), {
      method: 'PUT',
      body: booking,
    });
  }

  async delete(id: number): Promise<void> {
    await this.request<null>(bookingPath(id), { method: 'DELETE' });
  }

  private amount(money: Money): number {
    const currency = CurrencyManager.normalize(money.currency());

    if (currency !== this.channelCurrency) {
      throw new PayableError('Booking currency must match the Trust My Travel channel currency', {
        code: 'PROVIDER_TMT_BOOKING_CURRENCY_MISMATCH',
        context: {
          provider: 'trust-my-travel',
          currency,
          channelCurrency: this.channelCurrency,
        },
      });
    }

    return trustMyTravelAmount(money);
  }
}

function bookingPath(id?: number, paymentRequestUrl = false): string {
  const resource = id === undefined ? '/bookings' : `/bookings/${id}`;
  return paymentRequestUrl ? `${resource}?payment_request_url=true` : resource;
}

function assertTextFieldLengths(fields: TmtBookingFields): void {
  for (const [field, fieldValue] of Object.entries(fields)) {
    if (typeof fieldValue === 'string' && fieldValue.length > MAXIMUM_TEXT_LENGTH) {
      throw new PayableError(`Trust My Travel booking field ${field} exceeds the maximum length`, {
        code: 'PROVIDER_TMT_BOOKING_FIELD_TOO_LONG',
        context: { provider: 'trust-my-travel', field, maxLength: MAXIMUM_TEXT_LENGTH },
      });
    }
  }
}
