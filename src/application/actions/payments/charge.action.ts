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
import { SyncCustomerWithProviderAction } from '../customers/sync-customer-with-provider.action';

export interface ChargeActionInput {
  billable: Billable;
  amount: Money;
  reference?: string;
  description?: string;
}

export class ChargeAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(input: ChargeActionInput): Promise<Payment> {
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
    );
    if (!customer) {
      throw new CustomerNotFoundError(input.billable.billableId);
    }
    const provider = this.deps.provider;
    if (!isChargeCapable(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'charge');
    }
    const key = IdempotencyKey.forCharge({
      provider: this.deps.providerName,
      billableType: input.billable.billableType,
      billableId: input.billable.billableId,
      reference: input.reference ?? '',
      amount: input.amount.amount(),
      currency: input.amount.currency(),
    });
    const dto = await provider.charge(
      {
        providerCustomerId,
        amount: input.amount,
        reference: input.reference,
        description: input.description,
      },
      { correlationId: CorrelationId.generate().toString(), idempotencyKey: key.toString() },
    );
    return storage.payments.create({
      tenantId: null,
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
  }
}
