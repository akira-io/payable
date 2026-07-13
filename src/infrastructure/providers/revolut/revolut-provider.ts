import { createHash } from 'node:crypto';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type {
  CustomerCapable,
  DirectSubscriptionCapable,
  DisputeCapable,
  PaymentMethodCapable,
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
import type { DisputeDTO, ListDisputesInput } from '../../../domain/dtos/dispute.dto';
import type {
  DeletePaymentMethodInput,
  ListPaymentMethodsInput,
  PaymentMethodDTO,
} from '../../../domain/dtos/payment-method.dto';
import type { RefundInput, RefundResultDTO } from '../../../domain/dtos/refund.dto';
import type {
  CancelSubscriptionInput,
  CreateSubscriptionInput,
  SubscriptionDTO,
  UpdateSubscriptionInput,
} from '../../../domain/dtos/subscription.dto';
import type { VerifiedWebhook, WebhookVerificationInput } from '../../../domain/dtos/webhook.dto';
import { PayableError } from '../../../domain/errors/payable-error';
import { RevolutClient } from './revolut-client';
import { RevolutCustomers } from './revolut-customers';
import { RevolutDisputes } from './revolut-disputes';
import { RevolutEventNormalizer } from './revolut-event-normalizer';
import { toRevolutCheckoutSessionDTO, toRevolutRefundResultDTO } from './revolut-mappers';
import { RevolutPaymentMethods } from './revolut-payment-methods';
import { reconcileRevolutPaymentWebhook } from './revolut-payment-webhook-reconciliation';
import { reconcileRevolutSubscriptionWebhook } from './revolut-subscription-webhook-reconciliation';
import { RevolutSubscriptions } from './revolut-subscriptions';
import type {
  RevolutEnvironment,
  RevolutFetch,
  RevolutOrder,
  RevolutOrderCreationPayload,
  RevolutRefundPayload,
} from './revolut-types';
import { RevolutWebhookVerifier } from './revolut-webhook-verifier';

export { REVOLUT_MERCHANT_API_VERSION } from './revolut-client';

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
    PaymentMethodCapable,
    DisputeCapable,
    CustomerCapable,
    DirectSubscriptionCapable,
    SubscriptionManagementCapable
{
  readonly name = 'revolut';
  private readonly normalizer: RevolutEventNormalizer;
  private readonly verifier: RevolutWebhookVerifier;
  private readonly client: RevolutClient;
  private readonly customers: RevolutCustomers;
  private readonly subscriptions: RevolutSubscriptions;
  private readonly paymentMethods: RevolutPaymentMethods;
  private readonly disputes: RevolutDisputes;

  constructor(options: RevolutProviderOptions) {
    this.client = new RevolutClient(options);
    const request = this.client.request.bind(this.client);
    this.customers = new RevolutCustomers(request);
    this.subscriptions = new RevolutSubscriptions(request);
    this.paymentMethods = new RevolutPaymentMethods(request);
    this.disputes = new RevolutDisputes(request, this.client.environment);
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
    return new Set([
      'checkout',
      'refunds',
      'webhooks',
      'customers',
      'paymentMethods',
      'disputes',
      'subscriptions',
    ]);
  }

  createCustomer(input: CreateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.create(input, ctx);
  }

  updateCustomer(input: UpdateCustomerInput, ctx: OperationContext): Promise<CustomerDTO> {
    return this.customers.update(input, ctx);
  }

  listPaymentMethods(input: ListPaymentMethodsInput): Promise<PaymentMethodDTO[]> {
    return this.paymentMethods.list(input);
  }

  deletePaymentMethod(input: DeletePaymentMethodInput, ctx: OperationContext): Promise<void> {
    return this.paymentMethods.delete(input, ctx);
  }

  listDisputes(input?: ListDisputesInput): Promise<DisputeDTO[]> {
    return this.disputes.list(input);
  }

  retrieveDispute(providerDisputeId: string): Promise<DisputeDTO> {
    return this.disputes.retrieve(providerDisputeId);
  }

  acceptDispute(providerDisputeId: string, ctx: OperationContext): Promise<void> {
    return this.disputes.accept(providerDisputeId, ctx);
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
      merchant_order_data: input.reference ? { reference: input.reference } : undefined,
      redirect_url: input.successUrl,
    };
    const order = await this.client.request<RevolutOrder>('/api/orders', { method: 'POST', body });
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
      merchant_order_data: input.reference ? { reference: input.reference } : undefined,
    };
    const order = await this.client.request<RevolutOrder>(
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
}
