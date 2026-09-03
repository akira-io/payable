import {
  isCaptureCapable,
  isVoidCapable,
} from '../../../domain/contracts/payment-lifecycle-provider.contract';
import type { PaymentAllocationDTO } from '../../../domain/dtos/payment-lifecycle.dto';
import type { Payment } from '../../../domain/entities/payment.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import {
  PaymentCapturedEvent,
  PaymentVoidedEvent,
} from '../../../domain/events/payment-lifecycle.event';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import { Money } from '../../../domain/value-objects/money';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanChargePolicy } from '../../policies/can-charge.policy';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';

export interface CaptureAuthorizationRequest {
  amount?: Money;
  allocations?: PaymentAllocationDTO[];
  reference: string;
  authorization?: AuthorizationContext;
}

export interface VoidAuthorizationRequest {
  reference: string;
  authorization?: AuthorizationContext;
}

type Operation = 'capture' | 'void';

export class SettleAuthorizationAction {
  constructor(
    private readonly deps: BillingDependencies,
    private readonly paymentId: string,
  ) {}

  capture(input: CaptureAuthorizationRequest): Promise<Payment> {
    return this.handle('capture', input);
  }

  void(input: VoidAuthorizationRequest): Promise<Payment> {
    return this.handle('void', input);
  }

  private async handle(
    operation: Operation,
    input: CaptureAuthorizationRequest | VoidAuthorizationRequest,
  ): Promise<Payment> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => new CanChargePolicy().authorize(context),
      input.authorization,
      `${operation} payment authorization`,
    );
    const storage = this.deps.storage;
    if (!storage)
      throw new PayableError('Payment lifecycle requires storage', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    if (!this.deps.idempotency) {
      throw new PayableError('Payment lifecycle requires persistent idempotency', {
        code: 'PAYMENT_IDEMPOTENCY_REQUIRED',
      });
    }
    if (!this.deps.locks?.distributed) {
      throw new PayableError('Capture and void require a distributed lock driver', {
        code: 'PAYMENT_DISTRIBUTED_LOCK_REQUIRED',
      });
    }
    const initial = await storage.payments.findById(this.paymentId, this.deps.tenantId);
    if (!initial?.providerPaymentId) {
      throw new PayableError(`Payment not found: ${this.paymentId}`, { code: 'PAYMENT_NOT_FOUND' });
    }
    if (operation === 'capture') {
      assertCapableProvider(this.deps.provider, 'capture', isCaptureCapable);
    } else {
      assertCapableProvider(this.deps.provider, 'void', isVoidCapable);
    }
    await this.validate(initial, operation, input, false);
    const key = IdempotencyKey.of(
      `${operation}:${encodeURIComponent(this.deps.tenantId ?? '')}:${encodeURIComponent(initial.provider ?? '')}:${encodeURIComponent(initial.providerPaymentId)}:${encodeURIComponent(input.reference)}`,
    );
    const nativeIdempotency =
      operation === 'capture'
        ? isCaptureCapable(this.deps.provider) && this.deps.provider.captureIdempotency === 'native'
        : isVoidCapable(this.deps.provider) && this.deps.provider.voidIdempotency === 'native';
    return this.deps.idempotency.execute({
      key: key.toString(),
      storageKey: `payment-lifecycle:${encodeURIComponent(this.deps.tenantId ?? '')}:${encodeURIComponent(initial.provider ?? '')}:${encodeURIComponent(initial.providerPaymentId)}`,
      scope: 'payment',
      operation,
      request: {
        paymentId: this.paymentId,
        amount: 'amount' in input ? input.amount?.amount() : undefined,
        currency: 'amount' in input ? input.amount?.currency() : undefined,
        allocations:
          'allocations' in input
            ? input.allocations?.map((allocation) => ({
                reference: allocation.reference,
                amount: allocation.amount.amount(),
                currency: allocation.amount.currency(),
              }))
            : undefined,
        reference: input.reference,
      },
      resourceType: 'payment',
      resourceId: this.paymentId,
      tenantId: this.deps.tenantId,
      retryFailed: nativeIdempotency,
      failurePolicy: nativeIdempotency ? 'default' : 'reconciliation-required',
      run: () =>
        this.deps.locks?.withLock(
          `payment-lifecycle:${this.deps.tenantId ?? ''}:${initial.provider}:${initial.providerPaymentId}`,
          300_000,
          () => this.mutate(operation, input, key.toString()),
        ) as Promise<Payment>,
      revive: async (response) =>
        (await storage.payments.findById(this.paymentId, this.deps.tenantId)) ??
        (response as Payment),
    });
  }

  private async mutate(
    operation: Operation,
    input: CaptureAuthorizationRequest | VoidAuthorizationRequest,
    idempotencyKey: string,
  ): Promise<Payment> {
    const storage = this.deps.storage;
    if (!storage)
      throw new PayableError('Payment lifecycle requires storage', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    const payment = await storage.payments.findById(this.paymentId, this.deps.tenantId);
    if (!payment?.providerPaymentId) {
      throw new PayableError(`Payment not found: ${this.paymentId}`, { code: 'PAYMENT_NOT_FOUND' });
    }
    await this.validate(payment, operation, input, true);
    const correlationId = CorrelationId.generate().toString();
    const context = { correlationId, idempotencyKey };
    const nextStatus = operation === 'capture' ? 'succeeded' : 'canceled';
    let capturedAmount = payment.capturedAmount;
    let providerPaymentId = payment.providerPaymentId;
    if (operation === 'capture') {
      assertCapableProvider(this.deps.provider, 'capture', isCaptureCapable);
      const capture = input as CaptureAuthorizationRequest;
      const amount = capture.amount ?? Money.of(payment.amount, payment.currency);
      const result = await this.deps.provider.capture(
        { providerPaymentId: payment.providerPaymentId, amount, allocations: capture.allocations },
        context,
      );
      if (result.status !== 'succeeded') throw this.unknown(payment.id, result.status);
      capturedAmount = result.amount.amount();
      providerPaymentId = result.providerPaymentId;
    } else {
      assertCapableProvider(this.deps.provider, 'void', isVoidCapable);
      const result = await this.deps.provider.void(
        { providerPaymentId: payment.providerPaymentId },
        context,
      );
      if (result.status !== 'canceled') throw this.unknown(payment.id, result.status);
      providerPaymentId = result.providerPaymentId;
    }
    const settled = await storage.transaction(async (repos) => {
      const updated = await repos.payments.updateStatusIfUnchanged(
        payment.id,
        'authorized',
        { status: nextStatus, capturedAmount, providerPaymentId },
        this.deps.tenantId,
      );
      if (!updated) {
        throw new PayableError('Payment lifecycle state changed concurrently', {
          code: 'PAYMENT_LIFECYCLE_CONFLICT',
        });
      }
      const current = await repos.payments.findById(payment.id, this.deps.tenantId);
      if (!current) {
        throw new PayableError('Payment disappeared after settlement', {
          code: 'PAYMENT_NOT_FOUND',
        });
      }
      await repos.auditLogs.create({
        tenantId: this.deps.tenantId ?? null,
        correlationId,
        actorType: input.authorization?.actorType ?? null,
        actorId: input.authorization?.actorId ?? null,
        action: `payment.${operation === 'capture' ? 'captured' : 'voided'}`,
        resourceType: 'payment',
        resourceId: payment.id,
        before: { status: payment.status },
        after: { status: current.status, capturedAmount: current.capturedAmount },
        metadata: { provider: payment.provider },
        ipAddress: null,
        userAgent: null,
      });
      return current;
    });
    const amount = Money.of(
      operation === 'capture' ? capturedAmount : payment.amount,
      payment.currency,
    );
    const Event = operation === 'capture' ? PaymentCapturedEvent : PaymentVoidedEvent;
    await this.deps.events?.emit(
      new Event(
        { paymentId: payment.id, customerId: payment.customerId, amount },
        { correlationId, occurredAt: this.deps.clock.now() },
      ),
    );
    return settled;
  }

  private unknown(paymentId: string, status: string): PayableError {
    return new PayableError('Provider payment outcome requires reconciliation', {
      code: 'PAYMENT_OUTCOME_UNKNOWN',
      context: { paymentId, providerStatus: status },
    });
  }

  private async validate(
    payment: Payment,
    operation: Operation,
    input: CaptureAuthorizationRequest | VoidAuthorizationRequest,
    validateState: boolean,
  ): Promise<void> {
    if (input.reference.trim().length === 0) {
      throw new PayableError('Settlement reference is required', {
        code: 'PAYMENT_SETTLEMENT_INVALID',
      });
    }
    if (validateState && payment.status !== 'authorized') {
      throw new PayableError(`Payment ${payment.id} is not authorized`, {
        code: 'PAYMENT_NOT_AUTHORIZED',
        context: { paymentId: payment.id, status: payment.status },
      });
    }
    if (
      validateState &&
      payment.authorizationExpiresAt &&
      payment.authorizationExpiresAt.getTime() <= this.deps.clock.now().getTime()
    ) {
      const storage = this.deps.storage;
      const expired = await storage?.payments.updateStatusIfUnchanged(
        payment.id,
        'authorized',
        { status: 'failed' },
        this.deps.tenantId,
      );
      if (expired) {
        await storage?.auditLogs.create({
          tenantId: this.deps.tenantId ?? null,
          correlationId: CorrelationId.generate().toString(),
          actorType: input.authorization?.actorType ?? null,
          actorId: input.authorization?.actorId ?? null,
          action: 'payment.authorization_expired',
          resourceType: 'payment',
          resourceId: payment.id,
          before: { status: 'authorized' },
          after: { status: 'failed' },
          metadata: { provider: payment.provider },
          ipAddress: null,
          userAgent: null,
        });
      }
      throw new PayableError(`Payment ${payment.id} authorization expired`, {
        code: 'PAYMENT_AUTHORIZATION_EXPIRED',
      });
    }
    if (operation !== 'capture') return;
    const capture = input as CaptureAuthorizationRequest;
    const amount = capture.amount ?? Money.of(payment.amount, payment.currency);
    const allocationTotal = capture.allocations?.reduce(
      (total, allocation) => total + allocation.amount.amount(),
      0,
    );
    const allocationsValid = capture.allocations?.every(
      (allocation) =>
        allocation.reference.trim().length > 0 &&
        allocation.amount.amount() > 0 &&
        allocation.amount.currency() === amount.currency(),
    );
    if (
      amount.amount() <= 0 ||
      amount.amount() > payment.amount ||
      amount.currency() !== payment.currency ||
      allocationsValid === false ||
      (allocationTotal !== undefined && allocationTotal !== amount.amount())
    ) {
      throw new PayableError('Capture amount or allocations are invalid', {
        code: 'PAYMENT_CAPTURE_INVALID',
      });
    }
  }
}
