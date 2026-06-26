import type { SispConfig } from '@akira-io/sisp';
import type {
  PaymentProvider,
  RedirectCallbackCapable,
  RedirectCallbackResult,
} from '../../../domain/contracts/payment-provider.contract';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { sispAmount, sispDecimal, sispMoney } from './sisp-amounts';
import { withSispErrors } from './sisp-errors';
import { toCheckoutSessionDTO, toPaymentStatus, toRefundResultDTO } from './sisp-mappers';
import type { SispCallbackPayload, SispClient, SispHttpRequestInfo } from './sisp-types';

export type SispProviderOptions = SispConfig;

export class SispProvider implements PaymentProvider, RedirectCallbackCapable {
  readonly name = 'sisp';
  private client?: SispClient;

  constructor(
    private readonly options: SispProviderOptions,
    client?: SispClient,
  ) {
    this.client = client;
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `SispProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set(['checkout', 'refunds']);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    _ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    if (input.mode !== 'payment') {
      throw new PayableError('SISP only supports one-time payment checkouts', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, mode: input.mode },
      });
    }
    if (!input.amount) {
      throw new PayableError('SISP checkout requires an amount', {
        code: 'CHECKOUT_AMOUNT_REQUIRED',
        context: { provider: this.name },
      });
    }
    const client = await this.sisp();
    const amount = sispDecimal(input.amount);
    const merchantRef = client.config.generators.merchantReference();
    const request = this.paymentRequest({
      merchantRef,
      amount,
      items: [{ product_name: 'Payment', quantity: 1, unit_price: amount, total_price: amount }],
    });
    const result = await withSispErrors(() => client.handlers.handlePayment(request));
    if (result.type !== 'html') {
      throw new PayableError('SISP did not return a payment form', {
        code: 'PROVIDER_SISP_NO_FORM',
        context: { provider: this.name, resultType: result.type },
      });
    }
    return toCheckoutSessionDTO(merchantRef, client.driver().paymentEndpoint(), result.html);
  }

  async refund(input: RefundInput, _ctx: OperationContext): Promise<RefundResultDTO> {
    const client = await this.sisp();
    const transaction = await withSispErrors(() =>
      client.models.transactions.findByRef(input.providerPaymentId),
    );
    if (!transaction) {
      throw new PayableError(`SISP transaction not found: ${input.providerPaymentId}`, {
        code: 'PROVIDER_SISP_TRANSACTION_NOT_FOUND',
        context: { provider: this.name, merchantRef: input.providerPaymentId },
      });
    }
    const builder = client.refund(transaction);
    if (input.amount) {
      builder.amount(sispAmount(input.amount));
    } else {
      builder.full();
    }
    if (input.reason) {
      builder.reason(input.reason);
    }
    const refunded = await withSispErrors(() => builder.process());
    const amount = input.amount ?? sispMoney(transaction.amount, transaction.currency);
    return toRefundResultDTO(refunded, amount);
  }

  async verifyCallback(payload: SispCallbackPayload): Promise<boolean> {
    const client = await this.sisp();
    return client.validateCallback(payload);
  }

  async handleRedirectCallback(payload: SispCallbackPayload): Promise<RedirectCallbackResult> {
    const client = await this.sisp();
    const record = await withSispErrors(() => client.handlePaymentCallback(payload));
    return { providerPaymentId: record.merchant_ref, status: toPaymentStatus(record.status) };
  }

  private async sisp(): Promise<SispClient> {
    if (this.client) {
      return this.client;
    }
    const { createSisp } = await import('@akira-io/sisp');
    this.client = (await createSisp(this.options)) as unknown as SispClient;
    return this.client;
  }

  private paymentRequest(body: Record<string, unknown>): SispHttpRequestInfo {
    return { ip: '', method: 'POST', path: '', headers: {}, query: {}, body };
  }
}
