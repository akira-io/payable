import type Stripe from 'stripe';
import type {
  TerminalDeviceDTO,
  TerminalDeviceStatus,
  TerminalPaymentDTO,
  TerminalPaymentStatus,
} from '../../../domain/dtos/terminal.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeMoney } from './stripe-amounts';

export function mapStripeTerminalDevice(
  reader: Stripe.Terminal.Reader | Stripe.Terminal.DeletedReader,
): TerminalDeviceDTO {
  if (isDeletedStripeTerminalReader(reader)) {
    throw invalidStripeTerminalResponse('Stripe Terminal reader was deleted', {
      readerId: reader.id,
    });
  }
  return {
    providerDeviceId: reader.id,
    label: reader.label || null,
    locationId: stripeTerminalResourceId(reader.location),
    status: stripeTerminalDeviceStatus(reader),
    serialNumber: reader.serial_number || null,
    deviceType: reader.device_type,
  };
}

export function mapStripeTerminalPayment(
  reader: Stripe.Terminal.Reader,
  paymentIntent: Stripe.PaymentIntent,
  statusOverride?: TerminalPaymentStatus,
): TerminalPaymentDTO {
  return {
    providerTerminalPaymentId: reader.id,
    providerPaymentId: paymentIntent.id,
    providerDeviceId: reader.id,
    amount: stripeMoney(paymentIntent.amount, paymentIntent.currency),
    status: statusOverride ?? stripeTerminalPaymentStatus(reader.action, paymentIntent.status),
    failureCode: reader.action?.failure_code ?? paymentIntent.last_payment_error?.code ?? null,
    createdAt: new Date(paymentIntent.created * 1000),
    updatedAt: null,
  };
}

export function stripeTerminalActionPaymentIntentId(reader: Stripe.Terminal.Reader): string {
  const action = reader.action;
  if (action?.type !== 'process_payment_intent' || !action.process_payment_intent) {
    throw invalidStripeTerminalResponse('Stripe Terminal reader has no payment action', {
      readerId: reader.id,
    });
  }
  const paymentIntent = action.process_payment_intent.payment_intent;
  return typeof paymentIntent === 'string' ? paymentIntent : paymentIntent.id;
}

export function assertActiveStripeTerminalReader(
  reader: Stripe.Terminal.Reader | Stripe.Terminal.DeletedReader,
): Stripe.Terminal.Reader {
  if (isDeletedStripeTerminalReader(reader)) {
    throw invalidStripeTerminalResponse('Stripe Terminal reader was deleted', {
      readerId: reader.id,
    });
  }
  return reader;
}

function stripeTerminalDeviceStatus(reader: Stripe.Terminal.Reader): TerminalDeviceStatus {
  if (reader.action?.status === 'in_progress') {
    return 'busy';
  }
  if (reader.status === 'online' || reader.status === 'offline') {
    return reader.status;
  }
  return 'unknown';
}

function stripeTerminalPaymentStatus(
  action: Stripe.Terminal.Reader.Action | null,
  paymentIntentStatus: Stripe.PaymentIntent.Status,
): TerminalPaymentStatus {
  if (action?.status === 'failed') {
    return 'failed';
  }
  if (action?.status === 'in_progress') {
    return 'in_progress';
  }
  if (paymentIntentStatus === 'succeeded' || paymentIntentStatus === 'requires_capture') {
    return 'succeeded';
  }
  if (paymentIntentStatus === 'canceled') {
    return 'canceled';
  }
  if (paymentIntentStatus === 'processing') {
    return 'in_progress';
  }
  if (
    paymentIntentStatus === 'requires_payment_method' ||
    paymentIntentStatus === 'requires_confirmation' ||
    paymentIntentStatus === 'requires_action'
  ) {
    return 'pending';
  }
  return 'unknown';
}

function stripeTerminalResourceId(resource: { id: string } | string | null): string | null {
  if (!resource) {
    return null;
  }
  return typeof resource === 'string' ? resource : resource.id;
}

function isDeletedStripeTerminalReader(
  reader: Stripe.Terminal.Reader | Stripe.Terminal.DeletedReader,
): reader is Stripe.Terminal.DeletedReader {
  return reader.deleted === true;
}

function invalidStripeTerminalResponse(
  message: string,
  context: Record<string, unknown>,
): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_RESPONSE_INVALID',
    context: { provider: 'stripe-terminal', ...context },
  });
}
