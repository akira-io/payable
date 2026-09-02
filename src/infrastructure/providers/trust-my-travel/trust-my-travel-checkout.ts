import type { Clock } from '../../../domain/contracts/clock.contract';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { CurrencyManager } from '../../../domain/value-objects/currency';
import { createTmtAuthentication } from './trust-my-travel-authentication';
import type {
  TmtBookingCreateInput,
  TmtBookingResponse,
  TrustMyTravelBookings,
} from './trust-my-travel-bookings';
import type { TrustMyTravelEnvironment } from './trust-my-travel-types';

const DEFAULT_MODAL_VERSION = '3.6.1';
const PAYMENT_MODAL_URL = 'https://payment.tmtprotects.com';

interface BookingFields extends Omit<TmtBookingCreateInput, 'total'> {}

export interface TrustMyTravelCheckoutData {
  bookingId?: number;
  booking?: BookingFields;
  modal?: TrustMyTravelModalPayerData & {
    description?: string;
    pax?: number;
  };
}

export interface TrustMyTravelModalPayerData {
  payee_name: string;
  payee_email: string;
  payee_address: string;
  payee_city: string;
  payee_postcode: string;
  payee_country: string;
}

export interface TrustMyTravelCheckoutOptions {
  channelId: number;
  channelSecret: string;
  currency: string;
  environment: TrustMyTravelEnvironment;
  path: string;
  modalVersion?: string;
  clock?: Clock;
}

export class TrustMyTravelCheckout {
  constructor(
    private readonly bookings: TrustMyTravelBookings,
    private readonly options: TrustMyTravelCheckoutOptions,
  ) {}

  async create(input: CreateCheckoutSessionInput): Promise<CheckoutSessionDTO> {
    if (input.mode !== 'payment') {
      throw this.invalid('Trust My Travel only supports one-time payment checkouts');
    }
    if (!input.amount) {
      throw this.invalid('Trust My Travel checkout requires an amount', 'CHECKOUT_AMOUNT_REQUIRED');
    }
    if (
      CurrencyManager.normalize(input.amount.currency()) !==
      CurrencyManager.normalize(this.options.currency)
    ) {
      throw this.invalid(
        'Checkout currency must match the Trust My Travel channel currency',
        'PROVIDER_TMT_BOOKING_CURRENCY_MISMATCH',
      );
    }
    const data = checkoutData(input.providerData);
    assertModalData(data.modal);
    const version = this.modalVersion();
    const booking = await this.resolveBooking(data, input);
    this.assertBookingMatches(booking, input);
    const authentication = createTmtAuthentication(
      {
        channels: this.options.channelId,
        currencies: this.options.currency,
        total: input.amount.amount(),
        allocations: [],
        reference: input.reference,
      },
      this.options.channelSecret,
      this.options.clock,
    );
    const modalData = {
      ...publicModalData(data.modal),
      booking_auth: authentication.bookingAuth,
      booking_id: booking.id,
      channels: this.options.channelId,
      currencies: this.options.currency,
      total: input.amount.amount(),
      allocations: [],
      reference: input.reference,
    };
    const config = {
      path: this.options.path,
      environment: this.options.environment,
      data: modalData,
      ...(authentication.verify.length === 0 ? {} : { verify: authentication.verify }),
    };
    const serialized = JSON.stringify(config).replace(/</gu, '\\u003c');
    const html = `<script>window.tmtPaymentModalReady=function(){window.buPaymentTrustMyTravelModal=new window.tmtPaymentModalSdk(${serialized});window.dispatchEvent(new CustomEvent("bu-payment:tmt-modal-ready",{detail:window.buPaymentTrustMyTravelModal}));};</script><script src="${PAYMENT_MODAL_URL}/tmt-payment-modal.${version}.js"></script>`;

    return { id: String(booking.id), url: PAYMENT_MODAL_URL, html };
  }

  private modalVersion(): string {
    const version = this.options.modalVersion ?? DEFAULT_MODAL_VERSION;
    if (!/^\d+\.\d+\.\d+$/u.test(version)) {
      throw this.invalid(
        'Trust My Travel Payment Modal version is invalid',
        'PROVIDER_TMT_MODAL_VERSION_INVALID',
      );
    }
    return version;
  }

  private resolveBooking(
    data: TrustMyTravelCheckoutData,
    input: CreateCheckoutSessionInput,
  ): Promise<TmtBookingResponse> {
    if (data.bookingId !== undefined) {
      return this.bookings.find(data.bookingId);
    }
    if (!data.booking || !input.amount) {
      throw this.invalid(
        'Trust My Travel checkout requires providerData.bookingId or providerData.booking',
        'PROVIDER_TMT_BOOKING_REQUIRED',
      );
    }
    return this.bookings.create({ ...data.booking, total: input.amount });
  }

  private invalid(message: string, code = 'PROVIDER_OPERATION_UNSUPPORTED'): PayableError {
    return new PayableError(message, { code, context: { provider: 'trust-my-travel' } });
  }

  private assertBookingMatches(
    booking: TmtBookingResponse,
    input: CreateCheckoutSessionInput,
  ): void {
    const currency = CurrencyManager.normalize(booking.currencies);
    const expectedCurrency = CurrencyManager.normalize(this.options.currency);
    const amount = input.amount?.amount() ?? 0;
    const available = booking.total_unpaid ?? booking.total;
    if (
      booking.channels !== this.options.channelId ||
      currency !== expectedCurrency ||
      amount <= 0 ||
      amount > available
    ) {
      throw this.invalid(
        'Trust My Travel booking does not match the checkout channel, currency or available amount',
        'PROVIDER_TMT_BOOKING_MISMATCH',
      );
    }
  }
}

function publicModalData(
  data: TrustMyTravelModalPayerData & {
    description?: string;
    pax?: number;
  },
): Record<string, string | number> {
  return {
    payee_name: data.payee_name,
    payee_email: data.payee_email,
    payee_address: data.payee_address,
    payee_city: data.payee_city,
    payee_postcode: data.payee_postcode,
    payee_country: data.payee_country,
    ...(data.description === undefined ? {} : { description: data.description }),
    ...(data.pax === undefined ? {} : { pax: data.pax }),
  };
}

function checkoutData(value: Record<string, unknown> | undefined): TrustMyTravelCheckoutData {
  if (!value) return {};
  const bookingId = value.bookingId;
  if (bookingId !== undefined && (!Number.isInteger(bookingId) || Number(bookingId) <= 0)) {
    throw new PayableError('Trust My Travel bookingId must be a positive integer', {
      code: 'PROVIDER_TMT_BOOKING_ID_INVALID',
      context: { provider: 'trust-my-travel' },
    });
  }
  return value as TrustMyTravelCheckoutData;
}

function assertModalData(
  value: TrustMyTravelCheckoutData['modal'],
): asserts value is NonNullable<TrustMyTravelCheckoutData['modal']> {
  const required = [
    'payee_name',
    'payee_email',
    'payee_address',
    'payee_city',
    'payee_postcode',
    'payee_country',
  ] as const;
  if (!value || required.some((field) => typeof value[field] !== 'string' || !value[field])) {
    throw new PayableError('Trust My Travel Payment Modal payer data is required', {
      code: 'PROVIDER_TMT_MODAL_DATA_REQUIRED',
      context: { provider: 'trust-my-travel' },
    });
  }
  const limits: Record<string, number> = {
    payee_address: 50,
    payee_postcode: 50,
    payee_city: 45,
  };
  for (const [field, fieldValue] of Object.entries(value)) {
    const limit = limits[field] ?? 191;
    if (typeof fieldValue === 'string' && fieldValue.length > limit) {
      throw new PayableError(`Trust My Travel Payment Modal field ${field} is too long`, {
        code: 'PROVIDER_TMT_MODAL_FIELD_TOO_LONG',
        context: { provider: 'trust-my-travel', field, maxLength: limit },
      });
    }
  }
}
