import type Stripe from 'stripe';
import { vi } from 'vitest';

export function stripeTerminalPaymentIntent(
  overrides: Partial<Stripe.PaymentIntent> = {},
): Stripe.PaymentIntent {
  return {
    id: 'pi_terminal_1',
    object: 'payment_intent',
    amount: 2_500,
    amount_capturable: 0,
    amount_received: 0,
    application: null,
    application_fee_amount: null,
    automatic_payment_methods: null,
    canceled_at: null,
    cancellation_reason: null,
    capture_method: 'automatic',
    client_secret: null,
    confirmation_method: 'automatic',
    created: 1_725_100_000,
    currency: 'eur',
    customer: null,
    customer_account: null,
    description: null,
    excluded_payment_method_types: null,
    last_payment_error: null,
    latest_charge: null,
    livemode: false,
    managed_payments: null,
    metadata: { payable_terminal_reader_id: 'tmr_1' },
    next_action: null,
    on_behalf_of: null,
    payment_details: null,
    payment_method: null,
    payment_method_configuration_details: null,
    payment_method_options: {},
    payment_method_types: ['card_present'],
    processing: null,
    receipt_email: null,
    review: null,
    setup_future_usage: null,
    shipping: null,
    source: null,
    statement_descriptor: null,
    statement_descriptor_suffix: null,
    status: 'requires_payment_method',
    transfer_data: null,
    transfer_group: null,
    ...overrides,
  } as Stripe.PaymentIntent;
}

export function stripeTerminalReader(
  overrides: Partial<Stripe.Terminal.Reader> = {},
): Stripe.Terminal.Reader {
  return {
    id: 'tmr_1',
    object: 'terminal.reader',
    action: {
      api_error: null,
      failure_code: null,
      failure_message: null,
      process_payment_intent: { payment_intent: 'pi_terminal_1' },
      status: 'in_progress',
      type: 'process_payment_intent',
    },
    device_sw_version: '2.42.0',
    device_type: 'stripe_s700',
    ip_address: '10.0.0.20',
    label: 'Front desk',
    last_seen_at: 1_725_100_100_000,
    livemode: false,
    location: 'tml_1',
    metadata: {},
    serial_number: 'S700-123',
    status: 'online',
    ...overrides,
  } as Stripe.Terminal.Reader;
}

export function fakeStripeTerminal() {
  const reader = stripeTerminalReader();
  const offlineReader = stripeTerminalReader({
    id: 'tmr_2',
    action: null,
    status: 'offline',
  });
  const paymentIntent = stripeTerminalPaymentIntent();
  const readersPage = { autoPagingToArray: vi.fn().mockResolvedValue([reader, offlineReader]) };
  const calls = {
    readersList: vi.fn().mockReturnValue(readersPage),
    readersRetrieve: vi.fn().mockResolvedValue(reader),
    readersProcessPaymentIntent: vi.fn().mockResolvedValue(reader),
    readersCancelAction: vi.fn().mockResolvedValue({ ...reader, action: null }),
    paymentIntentsCreate: vi.fn().mockResolvedValue(paymentIntent),
    paymentIntentsRetrieve: vi.fn().mockResolvedValue(paymentIntent),
    paymentIntentsCancel: vi.fn().mockResolvedValue(
      stripeTerminalPaymentIntent({
        canceled_at: 1_725_100_200,
        cancellation_reason: 'requested_by_customer',
        status: 'canceled',
      }),
    ),
    readersPage,
  };
  const client = {
    terminal: {
      readers: {
        list: calls.readersList,
        retrieve: calls.readersRetrieve,
        processPaymentIntent: calls.readersProcessPaymentIntent,
        cancelAction: calls.readersCancelAction,
      },
    },
    paymentIntents: {
      cancel: calls.paymentIntentsCancel,
      create: calls.paymentIntentsCreate,
      retrieve: calls.paymentIntentsRetrieve,
    },
  } as unknown as Stripe;
  return { client, calls };
}
