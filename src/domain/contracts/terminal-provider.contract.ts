import type { OperationContext } from '../dtos/common.dto';
import type {
  CreateTerminalPaymentInput,
  ListTerminalDevicesInput,
  TerminalCapabilities,
  TerminalDeviceDTO,
  TerminalPaymentDTO,
} from '../dtos/terminal.dto';

export interface TerminalProvider {
  readonly name: string;
  capabilities(): TerminalCapabilities;
}

export interface TerminalDeviceCapable {
  listTerminalDevices(input?: ListTerminalDevicesInput): Promise<TerminalDeviceDTO[]>;
  retrieveTerminalDevice(providerDeviceId: string): Promise<TerminalDeviceDTO>;
}

export interface TerminalPaymentCapable {
  createTerminalPayment(
    input: CreateTerminalPaymentInput,
    ctx: OperationContext,
  ): Promise<TerminalPaymentDTO>;
  retrieveTerminalPayment(providerTerminalPaymentId: string): Promise<TerminalPaymentDTO>;
  cancelTerminalPayment(
    providerTerminalPaymentId: string,
    ctx: OperationContext,
  ): Promise<TerminalPaymentDTO>;
}

export function isTerminalDeviceCapable(
  provider: TerminalProvider,
): provider is TerminalProvider & TerminalDeviceCapable {
  const candidate = provider as Partial<TerminalDeviceCapable>;
  return (
    typeof candidate.listTerminalDevices === 'function' &&
    typeof candidate.retrieveTerminalDevice === 'function'
  );
}

export function isTerminalPaymentCapable(
  provider: TerminalProvider,
): provider is TerminalProvider & TerminalPaymentCapable {
  const candidate = provider as Partial<TerminalPaymentCapable>;
  return (
    typeof candidate.createTerminalPayment === 'function' &&
    typeof candidate.retrieveTerminalPayment === 'function' &&
    typeof candidate.cancelTerminalPayment === 'function'
  );
}
