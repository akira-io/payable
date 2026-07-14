import type {
  TerminalDeviceDTO,
  TerminalPaymentDTO,
  TerminalPaymentStatus,
} from '../../../domain/dtos/terminal.dto';
import { Money } from '../../../domain/value-objects/money';
import type {
  RevolutTerminal,
  RevolutTerminalPayment,
  RevolutTerminalPaymentIntent,
} from './revolut-types';

export function mapRevolutTerminalDevice(
  terminal: RevolutTerminal,
  locationId: string,
): TerminalDeviceDTO {
  return {
    providerDeviceId: terminal.id,
    label: terminal.name || null,
    locationId,
    status: terminal.online ? 'online' : 'offline',
    serialNumber: terminal.serial_number || null,
    deviceType: terminal.type,
  };
}

export function mapRevolutTerminalPayment(
  intent: RevolutTerminalPaymentIntent,
  payment?: RevolutTerminalPayment,
): TerminalPaymentDTO {
  return {
    providerTerminalPaymentId: intent.id,
    providerPaymentId: intent.payment_id ?? null,
    providerDeviceId: intent.terminal_id,
    amount: Money.of(intent.amount, intent.currency),
    status: payment ? revolutPaymentStatus(payment.state) : revolutIntentStatus(intent.state),
    failureCode: payment?.failure_reason ?? null,
    createdAt: parseDate(intent.created_at),
    updatedAt: parseDate(payment?.updated_at ?? intent.updated_at),
  };
}

function revolutIntentStatus(state: string): TerminalPaymentStatus {
  if (state === 'pending') {
    return 'pending';
  }
  if (state === 'processing' || state === 'completed') {
    return 'in_progress';
  }
  if (state === 'failed') {
    return 'failed';
  }
  if (state === 'cancelled') {
    return 'canceled';
  }
  return 'unknown';
}

function revolutPaymentStatus(state: string): TerminalPaymentStatus {
  if (state === 'captured' || state === 'completed') {
    return 'succeeded';
  }
  if (
    state === 'authorised' ||
    state === 'capture_started' ||
    state === 'declining' ||
    state === 'cancelling' ||
    state === 'failing'
  ) {
    return 'in_progress';
  }
  if (state === 'declined' || state === 'failed') {
    return 'failed';
  }
  if (state === 'cancelled') {
    return 'canceled';
  }
  return 'unknown';
}

function parseDate(value?: string): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
