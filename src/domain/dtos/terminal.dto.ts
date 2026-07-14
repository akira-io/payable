import type { Money } from '../value-objects/money';

export type TerminalCapability = 'devices' | 'payments';
export type TerminalCapabilityValue = TerminalCapability | (string & {});
export type TerminalCapabilities = ReadonlySet<TerminalCapabilityValue>;
export type TerminalDeviceStatus = 'online' | 'offline' | 'busy' | 'unknown';
export type TerminalPaymentStatus =
  | 'pending'
  | 'in_progress'
  | 'succeeded'
  | 'failed'
  | 'canceled'
  | 'unknown';

export interface TerminalDeviceDTO {
  providerDeviceId: string;
  label: string | null;
  locationId: string | null;
  status: TerminalDeviceStatus;
  serialNumber: string | null;
  deviceType: string;
}

export interface ListTerminalDevicesInput {
  locationId?: string;
  limit?: number;
}

export interface CreateTerminalPaymentInput {
  providerDeviceId: string;
  amount: Money;
  reference?: string;
  captureMethod?: 'automatic' | 'manual';
}

export interface TerminalPaymentDTO {
  providerTerminalPaymentId: string;
  providerPaymentId: string | null;
  providerDeviceId: string;
  amount: Money;
  status: TerminalPaymentStatus;
  failureCode: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}
