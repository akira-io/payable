import { isChargeCapable } from '../../../domain/contracts/payment-provider.contract';
import type { Payment } from '../../../domain/entities/payment.entity';
import { CustomerNotFoundError } from '../../../domain/errors/customer-not-found.error';
import { PayableError } from '../../../domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Money } from '../../../domain/value-objects/money';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanChargePolicy } from '../../policies/can-charge.policy';
import { SyncCustomerWithProviderAction } from '../customers/sync-customer-with-provider.action';

export interface ChargeActionInput {
  billable: Billable;
  amount: Money;
  reference?: string;
  description?: string;
  authorization?: AuthorizationContext;
}

export class ChargeAction {
  constructor(
    private readonly deps: BillingDependencies,
    private readonly policy = new CanChargePolicy(),
  ) {}

  async handle(input: ChargeActionInput): Promise<Payment> {
    assertAuthorized(
      this.deps.authorizationEnabled ?? false,
      (context) => this.policy.authorize(context),
      input.authorization,
      'charge',
    );
    const provider = this.deps.provider;
    if (!isChargeCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'charge');
    }
    const storage = this.deps.storage;
    if (!storage) {
      throw new PayableError('Charging requires a storage driver', {
        code: 'PAYMENT_STORAGE_REQUIRED',
      });
    }
    const providerCustomerId = await new SyncCustomerWithProviderAction(this.deps).handle(
      input.billable,
    );
    const customer = await storage.customers.findByBillable(
      input.billable.billableType,
      input.billable.billableId,
      this.deps.tenantId ?? null,
    );
    if (!customer) {
      throw new CustomerNotFoundError(input.billable.billableId);
    }
    if (this.deps.idempotency && input.reference === undefined) {
      this.deps.logger?.warn(
        'Charge has no reference; idempotency is disabled and a retry will create a duplicate charge',
        { billableId: input.billable.billableId },
      );
    }
    const dedupReference = input.reference ?? `nonce:${CorrelationId.generate().toString()}`;
    const key = IdempotencyKey.forCharge({
      tenantId: this.deps.tenantId ?? null,
      provider: this.deps.providerName,
      billableType: input.billable.billableType,
      billableId: input.billable.billableId,
      reference: dedupReference,
      amount: input.amount.amount(),
      currency: input.amount.currency(),
    });
    const run = async (): Promise<Payment> => {
      const dto = await provider.charge(
        {
          providerCustomerId,
          amount: input.amount,
          reference: input.reference,
          description: input.description,
        },
        { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
      );
      if (dto.amount.currency() !== input.amount.currency()) {
        throw new PayableError(
          `Charge currency ${dto.amount.currency()} does not match requested currency ${input.amount.currency()}`,
          { code: 'PAYMENT_CURRENCY_MISMATCH', context: { reference: input.reference ?? null } },
        );
      }
      return storage.payments.create({
        tenantId: this.deps.tenantId ?? null,
        customerId: customer.id,
        provider: this.deps.providerName,
        providerPaymentId: dto.providerPaymentId,
        status: dto.status,
        currency: dto.amount.currency(),
        amount: dto.amount.amount(),
        refundedAmount: 0,
        reference: input.reference ?? null,
        description: input.description ?? null,
      });
    };
    if (!this.deps.idempotency) {
      return run();
    }
    return this.deps.idempotency.execute({
      key: key.toString(),
      scope: 'payment',
      operation: 'charge',
      request: {
        billableType: input.billable.billableType,
        billableId: input.billable.billableId,
        reference: dedupReference,
        amount: input.amount.amount(),
        currency: input.amount.currency(),
      },
      resourceType: 'payment',
      tenantId: this.deps.tenantId,
      retryFailed: false,
      run,
    });
  }
}
