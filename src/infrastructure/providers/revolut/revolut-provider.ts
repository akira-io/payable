import { createHash } from 'node:crypto';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  CustomerCapable,
  DirectSubscriptionCapable,
  PaymentProvider,
  PaymentWebhookCapable,
  PaymentWebhookReconciliation,
  ResumeSubscriptionInput,
  SubscriptionManagementCapable,
  WebhookCapable,
} from '../../../domain/contracts/payment-provider.contract';
import type { ProviderCapabilities } from '../../../domain/dtos/capabilities.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../../../domain/dtos/checkout.dto';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type {
  CreateCustomerInput,
  CustomerDTO,
  UpdateCustomerInput,
} from '../../../domain/dtos/customer.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { RevolutCustomers } from './revolut-customers';
import { revolutNetworkError, toRevolutPayableError } from './revolut-errors';
import { RevolutEventNormalizer } from './revolut-event-normalizer';
import { toRevolutCheckoutSessionDTO, toRevolutRefundResultDTO } from './revolut-mappers';
import { reconcileRevolutPaymentWebhook } from './revolut-payment-webhook-reconciliation';
import { reconcileRevolutSubscriptionWebhook } from './revolut-subscription-webhook-reconciliation';
import { RevolutSubscriptions } from './revolut-subscriptions';
import type {
  RevolutEnvironment,
  RevolutFetch,
  RevolutOrder,
  RevolutOrderCreationPayload,
  RevolutRefundPayload,
  RevolutRequestOptions,
} from './revolut-types';
import { RevolutWebhookVerifier } from './revolut-webhook-verifier';

export const REVOLUT_MERCHANT_API_VERSION = '2026-04-20' as const;

const REVOLUT_BASE_URL: Record<RevolutEnvironment, string> = {
  production: 'https://merchant.revolut.com',
  sandbox: 'https://sandbox-merchant.revolut.com',
};

export interface RevolutProviderOptions {
  secretKey: string;
  webhookSecret: string;
  environment?: RevolutEnvironment;
  baseUrl?: string;
  apiVersion?: string;
  webhookToleranceMs?: number;
  logger?: Logger;
  fetch?: RevolutFetch;
}

export class RevolutProvider
  implements
    PaymentProvider,
    WebhookCapable,
    PaymentWebhookCapable,
    CustomerCapable,
    DirectSubscriptionCapable,
    SubscriptionManagementCapable
{
  readonly name = 'revolut';
  private readonly normalizer: RevolutEventNormalizer;
  private readonly verifier: RevolutWebhookVerifier;
  private readonly customers = new RevolutCustomers((path, options) => this.request(path, options));
  private readonly subscriptions = new RevolutSubscriptions((path, options) =>
    this.request(path, options),
  );

  constructor(private readonly options: RevolutProviderOptions) {
    this.normalizer = new RevolutEventNormalizer(options.logger);
    this.verifier = new RevolutWebhookVerifier(options.webhookSecret, options.webhookToleranceMs);
  }

  toJSON(): { name: string } {
    return { name: this.name };
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return `RevolutProvider { name: '${this.name}' }`;
  }

  capabilities(): ProviderCapabilities {
    return new Set(['checkout', 'refunds', 'webhooks', 'customers', 'subscriptions']);
  }

  createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.create(input, ctx);
  }

  updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.update(input, ctx);
  }

  async createCheckoutSession(
    input: CreateCheckoutSessionInput,
    ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    if (input.mode === 'subscription') {
      return this.subscriptions.createCheckout(input, ctx);
    }
    if (input.mode !== 'payment') {
      throw new PayableError('Revolut checkout mode is unsupported', {
        code: 'PROVIDER_OPERATION_UNSUPPORTED',
        context: { provider: this.name, mode: input.mode },
      });
    }
    if (!input.amount) {
      throw new PayableError('Revolut checkout requires an amount', {
        code: 'CHECKOUT_AMOUNT_REQUIRED',
        context: { provider: this.name },
      });
    }
    const body: RevolutOrderCreationPayload = {
      amount: input.amount.amount(),
      currency: input.amount.currency(),
      customer: { id: input.providerCustomerId },
      redirect_url: input.successUrl,
    };
    const order = await this.request<RevolutOrder>('/api/orders', { method: 'POST', body });
    return toRevolutCheckoutSessionDTO(order);
  }

  async refund(input: RefundInput, ctx: OperationContext): Promise<RefundResultDTO> {
    if (!input.amount) {
      throw new PayableError('Revolut refunds require an explicit amount', {
        code: 'REFUND_AMOUNT_REQUIRED',
        context: { provider: this.name, providerPaymentId: input.providerPaymentId },
      });
    }
    const body: RevolutRefundPayload = {
      amount: input.amount.amount(),
      currency: input.amount.currency(),
      description: input.reason,
    };
    const order = await this.request<RevolutOrder>(
      `/api/orders/${encodeURIComponent(input.providerPaymentId)}/refund`,
      { method: 'POST', body, idempotencyKey: ctx.idempotencyKey },
    );
    return toRevolutRefundResultDTO(order, input.amount);
  }

  createSubscription(
    input: CreateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.create(input, ctx);
  }

  updateSubscription(
    input: UpdateSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.update(input, ctx);
  }

  cancelSubscription(
    input: CancelSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.cancel(input, ctx);
  }

  resumeSubscription(
    input: ResumeSubscriptionInput,
    ctx: OperationContext,
  ): Promise<SubscriptionDTO> {
    return this.subscriptions.resume(input, ctx);
  }

  async verifyWebhook(input: WebhookVerificationInput): Promise<VerifiedWebhook> {
    const payload = this.verifier.verify(input);
    return {
      providerEventId: `revolut_${createHash('sha256').update(input.payload).digest('hex')}`,
      type: payload.event,
      normalizedType: this.normalizer.normalize(payload.event),
      data: payload,
    };
  }

  reconcileSubscription(verified: VerifiedWebhook): SubscriptionDTO | null {
    return reconcileRevolutSubscriptionWebhook(verified);
  }

  reconcilePayment(verified: VerifiedWebhook): PaymentWebhookReconciliation | null {
    return reconcileRevolutPaymentWebhook(verified);
  }

  private async request<T>(path: string, options: RevolutRequestOptions): Promise<T> {
    const response = await this.fetch(this.url(path), {
      method: options.method,
      headers: this.headers(options),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }).catch((error: unknown) => {
      throw revolutNetworkError(error);
    });
    const body = await parseResponseBody(response);
    if (!response.ok) {
      throw toRevolutPayableError(response.status, body);
    }
    return body as T;
  }

  private headers(options: RevolutRequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: `Bearer ${this.options.secretKey}`,
      'revolut-api-version': this.options.apiVersion ?? REVOLUT_MERCHANT_API_VERSION,
    };
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }
    if (options.idempotencyKey) {
      headers['idempotency-key'] = options.idempotencyKey;
    }
    return headers;
  }

  private url(path: string): string {
    return `${this.baseUrl()}${path}`;
  }

  private baseUrl(): string {
    return (
      this.options.baseUrl ?? REVOLUT_BASE_URL[this.options.environment ?? 'production']
    ).replace(/\/+$/, '');
  }

  private fetch(input: string | URL, init?: RequestInit): Promise<Response> {
    const request = this.options.fetch ?? globalThis.fetch;
    if (!request) {
      throw new PayableError('No fetch implementation available for RevolutProvider', {
        code: 'PROVIDER_HTTP_CLIENT_UNAVAILABLE',
        context: { provider: this.name },
      });
    }
    return request(input, init);
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}
