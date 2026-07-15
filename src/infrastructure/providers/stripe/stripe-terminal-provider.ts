import { createHash } from 'node:crypto';
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
import { PayableError } from '../../../domain/errors/payable-error';
import { stripeAmount } from './stripe-amounts';
import { STRIPE_API_VERSION } from './stripe-api-version';
import { withStripeErrors } from './stripe-errors';
import {
  assertActiveStripeTerminalReader,
  mapStripeTerminalDevice,
  mapStripeTerminalPayment,
  parseStripeTerminalPaymentId,
} from './stripe-terminal-mappers';

const DEFAULT_LIST_LIMIT = 100;
const STRIPE_PAGE_LIMIT = 100;
const STRIPE_IDEMPOTENCY_KEY_LIMIT = 255;
const TERMINAL_READER_METADATA_KEY = 'payable_terminal_reader_id';

type StripeTerminalWriteOperation = 'payment-intent' | 'reader-process';

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
    if (input.captureMethod === 'manual') {
      throw new PayableError('Stripe Terminal manual capture is not supported', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, captureMethod: input.captureMethod },
      });
    }
    const stripe = await this.stripe();
    const paymentIntent = await withStripeErrors(
      () =>
        stripe.paymentIntents.create(
          {
            amount: stripeAmount(input.amount),
            currency: input.amount.currency().toLowerCase(),
            capture_method: input.captureMethod ?? 'automatic',
            payment_method_types: ['card_present'],
            metadata: {
              [TERMINAL_READER_METADATA_KEY]: input.providerDeviceId,
              ...(input.reference ? { reference: input.reference } : {}),
            },
          },
          this.terminalWriteIdempotency(ctx, 'payment-intent'),
        ),
      this.name,
    );
    const reader = await withStripeErrors(
      () =>
        stripe.terminal.readers.processPaymentIntent(
          input.providerDeviceId,
          { payment_intent: paymentIntent.id },
          this.terminalWriteIdempotency(ctx, 'reader-process'),
        ),
      this.name,
    );
    return mapStripeTerminalPayment(reader, paymentIntent);
  }

  async retrieveTerminalPayment(providerTerminalPaymentId: string): Promise<TerminalPaymentDTO> {
    const identity = parseStripeTerminalPaymentId(providerTerminalPaymentId);
    const [reader, paymentIntent] = await Promise.all([
      this.retrieveReader(identity.providerDeviceId),
      this.retrievePaymentIntent(identity.providerPaymentIntentId),
    ]);
    this.assertPaymentIntentReader(paymentIntent, identity.providerDeviceId);
    return mapStripeTerminalPayment(reader, paymentIntent);
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

  private assertPaymentIntentReader(
    paymentIntent: Stripe.PaymentIntent,
    expectedReaderId: string,
  ): void {
    const actualReaderId = paymentIntent.metadata[TERMINAL_READER_METADATA_KEY] ?? null;
    if (actualReaderId !== expectedReaderId) {
      throw new PayableError('Stripe Terminal payment does not belong to the requested reader', {
        code: 'PROVIDER_REQUEST_INVALID',
        context: { provider: this.name, expectedReaderId, actualReaderId },
      });
    }
  }

  private terminalWriteIdempotency(
    ctx: OperationContext,
    operation: StripeTerminalWriteOperation,
  ): Stripe.RequestOptions | undefined {
    if (!ctx.idempotencyKey) {
      return undefined;
    }
    const suffix = `:stripe-terminal:${operation}`;
    const readableKey = `${ctx.idempotencyKey}${suffix}`;
    if (readableKey.length <= STRIPE_IDEMPOTENCY_KEY_LIMIT) {
      return { idempotencyKey: readableKey };
    }
    const digest = createHash('sha256').update(`${ctx.idempotencyKey}${suffix}`).digest('hex');
    return { idempotencyKey: `payable:stripe-terminal:${operation}:${digest}` };
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
