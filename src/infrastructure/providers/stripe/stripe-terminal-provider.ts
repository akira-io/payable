import type Stripe from 'stripe';
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
import { stripeAmount } from './stripe-amounts';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import {
  assertActiveStripeTerminalReader,
  mapStripeTerminalDevice,
  mapStripeTerminalPayment,
  stripeTerminalActionPaymentIntentId,
} from './stripe-terminal-mappers';

const DEFAULT_LIST_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;

export interface StripeTerminalProviderOptions {
  secretKey: string;
}

export class StripeTerminalProvider
  implements TerminalProvider, TerminalDeviceCapable, TerminalPaymentCapable
{
  readonly name = 'stripe-terminal';
  private client?: Stripe;

  constructor(
    private readonly options: StripeTerminalProviderOptions,
    client?: unknown,
  ) {
    this.client = client as Stripe | undefined;
  }

  capabilities(): TerminalCapabilities {
    return new Set(['devices', 'payments']);
  }

  async listTerminalDevices(input: ListTerminalDevicesInput = {}): Promise<TerminalDeviceDTO[]> {
    const stripe = await this.stripe();
    const limit = input.limit ?? DEFAULT_LIST_LIMIT;
    const readers = await withStripeErrors(
      () =>
        stripe.terminal.readers
          .list({ location: input.locationId, limit: Math.min(limit, STRIPE_PAGE_LIMIT) })
          .autoPagingToArray({ limit }),
      this.name,
    );
    return readers.map(mapStripeTerminalDevice);
  }

  async retrieveTerminalDevice(providerDeviceId: string): Promise<TerminalDeviceDTO> {
    return mapStripeTerminalDevice(await this.retrieveReader(providerDeviceId));
  }

  async createTerminalPayment(
    input: CreateTerminalPaymentInput,
    ctx: OperationContext,
  ): Promise<TerminalPaymentDTO> {
    const stripe = await this.stripe();
    const paymentIntent = await withStripeErrors(
      () =>
        stripe.paymentIntents.create(
          {
            amount: stripeAmount(input.amount),
            currency: input.amount.currency().toLowerCase(),
            capture_method: input.captureMethod ?? 'automatic',
            payment_method_types: ['card_present'],
            metadata: input.reference ? { reference: input.reference } : undefined,
          },
          this.idempotency(ctx),
        ),
      this.name,
    );
    const reader = await withStripeErrors(
      () =>
        stripe.terminal.readers.processPaymentIntent(
          input.providerDeviceId,
          { payment_intent: paymentIntent.id },
          this.idempotency(ctx),
        ),
      this.name,
    );
    return mapStripeTerminalPayment(reader, paymentIntent);
  }

  async retrieveTerminalPayment(providerTerminalPaymentId: string): Promise<TerminalPaymentDTO> {
    const reader = await this.retrieveReader(providerTerminalPaymentId);
    const paymentIntent = await this.retrievePaymentIntent(
      stripeTerminalActionPaymentIntentId(reader),
    );
    return mapStripeTerminalPayment(reader, paymentIntent);
  }

  async cancelTerminalPayment(
    providerTerminalPaymentId: string,
    ctx: OperationContext,
  ): Promise<TerminalPaymentDTO> {
    const reader = await this.retrieveReader(providerTerminalPaymentId);
    const paymentIntentId = stripeTerminalActionPaymentIntentId(reader);
    const stripe = await this.stripe();
    await withStripeErrors(
      () =>
        stripe.terminal.readers.cancelAction(providerTerminalPaymentId, {}, this.idempotency(ctx)),
      this.name,
    );
    return mapStripeTerminalPayment(
      reader,
      await this.retrievePaymentIntent(paymentIntentId),
      'canceled',
    );
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `StripeTerminalProvider { name: '${this.name}' }`;
  }

  private async retrieveReader(providerDeviceId: string): Promise<Stripe.Terminal.Reader> {
    const stripe = await this.stripe();
    return assertActiveStripeTerminalReader(
      await withStripeErrors(() => stripe.terminal.readers.retrieve(providerDeviceId), this.name),
    );
  }

  private async retrievePaymentIntent(providerPaymentId: string): Promise<Stripe.PaymentIntent> {
    const stripe = await this.stripe();
    return withStripeErrors(() => stripe.paymentIntents.retrieve(providerPaymentId), this.name);
  }

  private idempotency(ctx: OperationContext): Stripe.RequestOptions {
    return { idempotencyKey: ctx.idempotencyKey };
  }

  private async stripe(): Promise<Stripe> {
    if (this.client) {
      return this.client;
    }
    const { default: StripeClient } = await import('stripe');
    this.client = new StripeClient(this.options.secretKey, { apiVersion: STRIPE_API_VERSION });
    return this.client;
  }
}
