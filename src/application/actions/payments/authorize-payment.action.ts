import { isAuthorizeCapable } from '../../../domain/contracts/payment-lifecycle-provider.contract';
import type { CheckoutSessionDTO } from '../../../domain/dtos/checkout.dto';
import type { Payment } from '../../../domain/entities/payment.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { PaymentAuthorizedEvent } from '../../../domain/events/payment-lifecycle.event';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { AuthorizePaymentRequest } from '../../builders/authorize-payment-request';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import { CanChargePolicy } from '../../policies/can-charge.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { SyncCustomerWithProviderAction } from '../customers/sync-customer-with-provider.action';

export interface AuthorizePaymentActionInput extends AuthorizePaymentRequest {
  billable: Billable;
}

export interface AuthorizePaymentResult {
  payment: Payment;
  checkout?: CheckoutSessionDTO;
}

export class AuthorizePaymentAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(input: AuthorizePaymentActionInput): Promise<AuthorizePaymentResult> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanChargePolicy().authorize(context),
      input.authorization,
      'authorize payment',
    );
    if (input.amount.amount() <= 0 || input.reference.trim().length === 0) {
      throw new PayableError('Authorization amount and reference are required', {
        code: 'PAYMENT_AUTHORIZATION_INVALID',
      });
    }
    const storage = this.deps.storage;
    if (!storage)
      throw new PayableError('Authorization requires storage', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    if (!this.deps.idempotency) {
      throw new PayableError('Authorization requires persistent idempotency', {
        code: 'PAYMENT_IDEMPOTENCY_REQUIRED',
      });
    }
    assertCapableProvider(this.deps.provider, 'authorize', isAuthorizeCapable);
    const provider = this.deps.provider;
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      input.billable,
    );
    const customer = await storage.customers.findByBillable(
      input.billable.billableType,
      input.billable.billableId,
      this.deps.tenantId,
    );
    if (!customer) throw new PayableError('Customer not found', { code: 'CUSTOMER_NOT_FOUND' });
    const key = IdempotencyKey.of(
      `authorize:${encodeURIComponent(this.deps.tenantId ?? '')}:${encodeURIComponent(this.deps.providerName)}:${encodeURIComponent(customer.id)}:${encodeURIComponent(input.reference)}`,
    );
    const correlationId = CorrelationId.generate().toString();
    const nativeIdempotency = provider.authorizeIdempotency === 'native';
    return this.deps.idempotency.execute({
      key: key.toString(),
      scope: 'payment',
      operation: 'authorize',
      request: {
        amount: input.amount.amount(),
        currency: input.amount.currency(),
        reference: input.reference,
        customerId: customer.id,
        providerCustomerId,
        description: input.description,
        paymentMethodId: input.paymentMethodId,
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
        providerData: input.providerData,
      },
      resourceType: 'payment',
      tenantId: this.deps.tenantId,
      retryFailed: nativeIdempotency,
      failurePolicy: nativeIdempotency ? 'default' : 'reconciliation-required',
      run: async () => {
        const dto = await provider.authorize(
          {
            providerCustomerId,
            amount: input.amount,
            reference: input.reference,
            description: input.description,
            paymentMethodId: input.paymentMethodId,
            successUrl: input.successUrl,
            cancelUrl: input.cancelUrl,
            providerData: input.providerData,
          },
          { correlationId, idempotencyKey: key.toString() },
        );
        if (
          dto.amount.amount() !== input.amount.amount() ||
          dto.amount.currency() !== input.amount.currency()
        ) {
          throw new PayableError('Provider authorization amount differs from the request', {
            code: 'PAYMENT_AMOUNT_MISMATCH',
          });
        }
        const providerPaymentId = dto.providerPaymentId ?? dto.checkout?.id;
        const recovered = providerPaymentId
          ? await storage.payments.findByProviderId(
              this.deps.providerName,
              providerPaymentId,
              this.deps.tenantId,
            )
          : null;
        if (recovered && recovered.customerId !== customer.id) {
          throw new PayableError('Provider authorization belongs to another customer', {
            code: 'PAYMENT_PROVIDER_IDENTITY_CONFLICT',
          });
        }
        const payment =
          recovered ??
          (await storage.transaction(async (repos) => {
            const created = await repos.payments.create({
              tenantId: this.deps.tenantId ?? null,
              customerId: customer.id,
              provider: this.deps.providerName,
              providerPaymentId: providerPaymentId ?? null,
              status: dto.status,
              currency: dto.amount.currency(),
              amount: dto.amount.amount(),
              refundedAmount: 0,
              capturedAmount: 0,
              authorizedAt: dto.status === 'authorized' ? this.deps.clock.now() : null,
              authorizationExpiresAt: dto.expiresAt ?? null,
              reference: input.reference,
              description: input.description ?? null,
            });
            await repos.auditLogs.create({
              tenantId: this.deps.tenantId ?? null,
              correlationId,
              actorType: input.authorization?.actorType ?? null,
              actorId: input.authorization?.actorId ?? null,
              action:
                created.status === 'authorized'
                  ? 'payment.authorized'
                  : 'payment.authorization_requested',
              resourceType: 'payment',
              resourceId: created.id,
              before: null,
              after: {
                status: created.status,
                authorizationExpiresAt: created.authorizationExpiresAt,
              },
              metadata: { provider: created.provider },
              ipAddress: null,
              userAgent: null,
            });
            return created;
          }));
        if (!recovered && payment.status === 'authorized') {
          await this.deps.events?.emit(
            new PaymentAuthorizedEvent(
              { paymentId: payment.id, customerId: payment.customerId, amount: input.amount },
              { correlationId, occurredAt: this.deps.clock.now() },
            ),
          );
        }
        return { payment, ...(dto.checkout ? { checkout: dto.checkout } : {}) };
      },
      revive: async (response) => {
        const result = response as AuthorizePaymentResult;
        const payment = await storage.payments.findById(result.payment.id, this.deps.tenantId);
        return { ...result, payment: payment ?? result.payment };
      },
    });
  }
}
