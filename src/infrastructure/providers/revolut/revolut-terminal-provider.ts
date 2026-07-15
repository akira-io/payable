import type {
  TerminalDeviceCapable,
  TerminalPaymentCapable,
  TerminalProvider,
} from '../../../domain/contracts/terminal-provider.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateTerminalPaymentInput,
  ListTerminalDevicesInput,
  TerminalCapabilities,
  TerminalDeviceDTO,
  TerminalPaymentDTO,
} from '../../../domain/dtos/terminal.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import {
  RevolutTerminalClient,
  type RevolutTerminalClientOptions,
} from './revolut-terminal-client';
import { mapRevolutTerminalDevice, mapRevolutTerminalPayment } from './revolut-terminal-mappers';
import type {
  RevolutOrder,
  RevolutTerminalOrderCreationPayload,
  RevolutTerminalPayment,
  RevolutTerminalPaymentIntent,
  RevolutTerminalPaymentIntentCreationPayload,
  RevolutTerminals,
} from './revolut-types';

export interface RevolutTerminalProviderOptions extends RevolutTerminalClientOptions {
  locationId: string;
  fulfilmentType?: 'eat_in' | 'take_away';
  posPartnerName?: string;
}

export class RevolutTerminalProvider
  implements TerminalProvider, TerminalDeviceCapable, TerminalPaymentCapable
{
  readonly name = 'revolut-terminal';
  private readonly client: RevolutTerminalClient;

  constructor(private readonly options: RevolutTerminalProviderOptions) {
    this.client = new RevolutTerminalClient(options);
  }

  capabilities(): TerminalCapabilities {
    return new Set(['devices', 'payments', 'paymentCancellation']);
  }

  async listTerminalDevices(input: ListTerminalDevicesInput = {}): Promise<TerminalDeviceDTO[]> {
    const locationId = input.locationId ?? this.options.locationId;
    const query = new URLSearchParams({ operation_mode: 'pos', location_id: locationId });
    const response = await this.client.request<RevolutTerminals>(`/api/terminals?${query}`, {
      method: 'GET',
    });
    const devices = response.terminals.map((terminal) =>
      mapRevolutTerminalDevice(terminal, locationId),
    );
    return input.limit === undefined ? devices : devices.slice(0, input.limit);
  }

  async retrieveTerminalDevice(providerDeviceId: string): Promise<TerminalDeviceDTO> {
    const devices = await this.listTerminalDevices();
    const device = devices.find((candidate) => candidate.providerDeviceId === providerDeviceId);
    if (!device) {
      throw terminalRequestError('Revolut Terminal was not found', { providerDeviceId });
    }
    return device;
  }

  async createTerminalPayment(
    input: CreateTerminalPaymentInput,
    _ctx: OperationContext,
  ): Promise<TerminalPaymentDTO> {
    if (input.captureMethod === 'manual') {
      throw new PayableError('Revolut Terminal does not expose manual capture control', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, operation: 'manual_capture' },
      });
    }
    const device = await this.retrieveTerminalDevice(input.providerDeviceId);
    if (device.status !== 'online') {
      throw terminalRequestError('Revolut Terminal is not online', {
        providerDeviceId: input.providerDeviceId,
      });
    }
    const order = await this.createOrder(input);
    const intent = await this.client.request<RevolutTerminalPaymentIntent>(
      `/api/orders/${encodeURIComponent(order.id)}/payment-intents`,
      {
        method: 'POST',
        body: {
          amount: input.amount.amount(),
          terminal_id: input.providerDeviceId,
        } satisfies RevolutTerminalPaymentIntentCreationPayload,
      },
    );
    return mapRevolutTerminalPayment(intent);
  }

  async retrieveTerminalPayment(providerTerminalPaymentId: string): Promise<TerminalPaymentDTO> {
    const intent = await this.retrieveIntent(providerTerminalPaymentId);
    if (intent.state !== 'completed' || !intent.payment_id) {
      return mapRevolutTerminalPayment(intent);
    }
    const payment = await this.client.request<RevolutTerminalPayment>(
      `/api/payments/${encodeURIComponent(intent.payment_id)}`,
      { method: 'GET' },
    );
    return mapRevolutTerminalPayment(intent, payment);
  }

  async cancelTerminalPayment(
    providerTerminalPaymentId: string,
    _ctx: OperationContext,
  ): Promise<TerminalPaymentDTO> {
    const intent = await this.client.request<RevolutTerminalPaymentIntent>(
      `/api/payment-intents/${encodeURIComponent(providerTerminalPaymentId)}/cancel`,
      { method: 'POST' },
    );
    return mapRevolutTerminalPayment(intent);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `RevolutTerminalProvider { name: '${this.name}' }`;
  }

  private createOrder(input: CreateTerminalPaymentInput): Promise<RevolutOrder> {
    return this.client.request<RevolutOrder>('/api/orders', {
      method: 'POST',
      body: {
        amount: input.amount.amount(),
        currency: input.amount.currency(),
        channel: 'pos',
        location_id: this.options.locationId,
        fulfilment_type: this.options.fulfilmentType ?? 'eat_in',
        capture_mode: 'manual',
        merchant_order_data: input.reference ? { reference: input.reference } : undefined,
        metadata: { pos_partner_name: this.options.posPartnerName ?? 'Payable' },
      } satisfies RevolutTerminalOrderCreationPayload,
    });
  }

  private retrieveIntent(providerTerminalPaymentId: string): Promise<RevolutTerminalPaymentIntent> {
    return this.client.request<RevolutTerminalPaymentIntent>(
      `/api/payment-intents/${encodeURIComponent(providerTerminalPaymentId)}`,
      { method: 'GET' },
    );
  }
}

function terminalRequestError(message: string, context: Record<string, unknown>): PayableError {
  return new PayableError(message, {
    code: 'PROVIDER_REQUEST_INVALID',
    context: { provider: 'revolut-terminal', ...context },
  });
}
