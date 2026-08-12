import type { Payment } from '../../domain/entities/payment.entity';
import { PayableError } from '../../domain/errors/payable-error';
import { PaymentStateMachine } from '../../domain/states/payment-state-machine';
import { assertAuthorized } from '../policies/assert-authorized';
import { CanChargePolicy } from '../policies/can-charge.policy';
import type { LocalDependencies } from './local-dependencies';
import type { RecordLocalPaymentInput, TransitionLocalPaymentInput } from './local-payment-inputs';

export class LocalPaymentActions {
  constructor(
    private readonly dependencies: LocalDependencies,
    private readonly policy = new CanChargePolicy(),
  ) {}

  async record(input: RecordLocalPaymentInput): Promise<Payment> {
    this.authorize(input.authorization, 'record local payment');
    this.validate(input);
    const tenantId = this.dependencies.tenantId ?? null;
    if (this.dependencies.idempotency && input.idempotencyKey) {
      return this.dependencies.idempotency.execute({
        key: input.idempotencyKey,
        scope: 'local-payment',
        operation: 'record',
        tenantId,
        request: this.request(input),
        resourceType: 'payment',
        retryFailed: false,
        failurePolicy: 'reconciliation-required',
        run: () => this.persist(input),
        revive: async (response) => {
          const payment = await this.storage().payments.findById(
            (response as { id: string }).id,
            tenantId,
          );
          return payment ?? (response as Payment);
        },
      });
    }
    return this.persist(input);
  }

  succeed(id: string, input: TransitionLocalPaymentInput = {}): Promise<Payment> {
    return this.transitionIdempotently(id, 'succeed', input);
  }

  void(id: string, input: TransitionLocalPaymentInput = {}): Promise<Payment> {
    return this.transitionIdempotently(id, 'cancel', input);
  }

  private transitionIdempotently(
    id: string,
    event: 'succeed' | 'cancel',
    input: TransitionLocalPaymentInput,
  ): Promise<Payment> {
    this.authorize(input.authorization, `${event === 'cancel' ? 'void' : event} local payment`);
    const tenantId = this.dependencies.tenantId ?? null;
    if (this.dependencies.idempotency && input.idempotencyKey) {
      return this.dependencies.idempotency.execute({
        key: input.idempotencyKey,
        scope: 'local-payment',
        operation: event === 'cancel' ? 'void' : event,
        tenantId,
        request: { paymentId: id, operation: event === 'cancel' ? 'void' : event },
        resourceType: 'payment',
        resourceId: id,
        retryFailed: false,
        failurePolicy: 'reconciliation-required',
        run: () => this.transition(id, event, input.authorization),
        revive: async () => {
          const payment = await this.storage().payments.findById(id, tenantId);
          if (!payment) {
            throw new PayableError(`Payment not found: ${id}`, { code: 'PAYMENT_NOT_FOUND' });
          }
          return payment;
        },
      });
    }
    return this.transition(id, event, input.authorization);
  }

  private async persist(input: RecordLocalPaymentInput): Promise<Payment> {
    const storage = this.storage();
    const tenantId = this.dependencies.tenantId ?? null;
    const customer = await storage.customers.findById(input.customerId, tenantId);
    if (!customer) {
      throw new PayableError(`Customer not found: ${input.customerId}`, {
        code: 'CUSTOMER_NOT_FOUND',
      });
    }
    return storage.transaction(async (repositories) => {
      const payment = await repositories.payments.create({
        tenantId,
        customerId: customer.id,
        provider: null,
        providerPaymentId: null,
        status: input.status,
        currency: input.amount.currency(),
        amount: input.amount.amount(),
        refundedAmount: 0,
        reference: null,
        description: input.description?.trim() || null,
        collectionMethod: input.collectionMethod,
        occurredAt: input.occurredAt ?? this.dependencies.clock.now(),
        externalReference: input.externalReference?.trim() || null,
        recordedBy: input.authorization?.actorId ?? null,
      });
      const correlationId = globalThis.crypto.randomUUID();
      await repositories.auditLogs.create({
        tenantId,
        correlationId,
        actorType: input.authorization?.actorType ?? null,
        actorId: input.authorization?.actorId ?? null,
        action: 'payment.local_recorded',
        resourceType: 'payment',
        resourceId: payment.id,
        before: null,
        after: { status: payment.status, amount: payment.amount, currency: payment.currency },
        metadata: { collectionMethod: payment.collectionMethod },
        ipAddress: null,
        userAgent: null,
      });
      await repositories.outboxEvents.create({
        tenantId,
        correlationId,
        eventType: 'payment.local_recorded',
        eventVersion: 1,
        payload: { paymentId: payment.id, status: payment.status },
        dedupeKey: `payment.local_recorded:${payment.id}`,
      });
      return payment;
    });
  }

  private async transition(
    id: string,
    event: 'succeed' | 'cancel',
    authorization?: TransitionLocalPaymentInput['authorization'],
  ): Promise<Payment> {
    const tenantId = this.dependencies.tenantId ?? null;
    return this.storage().transaction(async (repositories) => {
      const payment = await repositories.payments.findByIdForUpdate(id, tenantId);
      if (!payment || payment.provider !== null || payment.status !== 'pending') {
        throw new PayableError(
          `Payment ${id} cannot be ${event === 'cancel' ? 'voided' : 'succeeded'}`,
          { code: 'PAYMENT_STATE_INVALID' },
        );
      }
      const machine = new PaymentStateMachine(payment.status);
      const status = event === 'succeed' ? machine.succeed().current() : machine.cancel().current();
      const updated = await repositories.payments.update(id, { status }, tenantId);
      const correlationId = globalThis.crypto.randomUUID();
      const action = event === 'cancel' ? 'payment.local_voided' : 'payment.local_succeeded';
      await repositories.auditLogs.create({
        tenantId,
        correlationId,
        actorType: authorization?.actorType ?? null,
        actorId: authorization?.actorId ?? null,
        action,
        resourceType: 'payment',
        resourceId: id,
        before: { status: payment.status },
        after: { status },
        metadata: null,
        ipAddress: null,
        userAgent: null,
      });
      await repositories.outboxEvents.create({
        tenantId,
        correlationId,
        eventType: action,
        eventVersion: 1,
        payload: { paymentId: id, status },
        dedupeKey: `${action}:${id}`,
      });
      return updated;
    });
  }

  private validate(input: RecordLocalPaymentInput): void {
    if (input.amount.amount() <= 0) {
      throw new PayableError('Local payment amount must be positive', {
        code: 'PAYMENT_AMOUNT_INVALID',
      });
    }
    if (
      input.collectionMethod === 'other' &&
      !input.externalReference?.trim() &&
      !input.description?.trim()
    ) {
      throw new PayableError('Other collection methods require evidence', {
        code: 'PAYMENT_COLLECTION_EVIDENCE_REQUIRED',
      });
    }
  }

  private request(input: RecordLocalPaymentInput): Record<string, unknown> {
    return {
      customerId: input.customerId,
      amount: input.amount.amount(),
      currency: input.amount.currency(),
      status: input.status,
      collectionMethod: input.collectionMethod,
      occurredAt: input.occurredAt?.toISOString() ?? null,
      externalReference: input.externalReference ?? null,
      description: input.description ?? null,
    };
  }

  private authorize(
    authorization: TransitionLocalPaymentInput['authorization'],
    operation: string,
  ): void {
    assertAuthorized(
      this.dependencies.authorizationEnabled ?? false,
      (context) => this.policy.authorize(context),
      authorization,
      operation,
    );
  }

  private storage() {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new PayableError('Stored payment writes require a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    return storage;
  }
}
