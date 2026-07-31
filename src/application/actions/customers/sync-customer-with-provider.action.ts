import { isCustomerCapable } from '../../../domain/contracts/payment-provider.contract';
import { CustomerProviderBindingConflictError } from '../../../domain/errors/customer-provider-binding-conflict.error';
import { CustomerProviderBindingPersistenceError } from '../../../domain/errors/customer-provider-binding-persistence.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { EnsureCustomerAction } from './ensure-customer.action';
import { normalizeCustomerEmail } from './normalize-customer-email';

export class SyncCustomerWithProviderAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable): Promise<string> {
    const { provider, providerName, storage, idempotency } = this.deps;
    assertCapableProvider(provider, 'customers', isCustomerCapable);
    const tenantId = this.deps.tenantId ?? null;
    const email = normalizeCustomerEmail(billable.email);
    let customerId: string | undefined;
    if (storage) {
      const customer = await new EnsureCustomerAction(this.deps).handle(billable);
      customerId = customer.id;
      const existing = await storage.customerProviderBindings.findByCustomerAndProvider(
        customer.id,
        providerName,
        tenantId,
      );
      if (existing) {
        return existing.providerCustomerId;
      }
    }
    const key = IdempotencyKey.forCustomer({
      tenantId,
      provider: providerName,
      billableType: billable.billableType,
      billableId: billable.billableId,
    });
    const run = async (): Promise<string> => {
      const dto = await provider.createCustomer(
        {
          email,
          name: billable.name,
          billableType: billable.billableType,
          billableId: billable.billableId,
        },
        {
          correlationId: CorrelationId.generate().toString(),
          idempotencyKey: key.toString(),
        },
      );
      if (storage && customerId) {
        await this.persist(customerId, dto.providerCustomerId);
      }
      return dto.providerCustomerId;
    };
    if (!idempotency) {
      return run();
    }
    return idempotency.execute({
      key: key.toString(),
      scope: 'customer',
      operation: 'sync',
      request: { billableType: billable.billableType, billableId: billable.billableId },
      resourceType: 'customer',
      tenantId: this.deps.tenantId,
      run,
    });
  }

  private async persist(customerId: string, providerCustomerId: string): Promise<void> {
    const { storage, providerName } = this.deps;
    if (!storage) {
      return;
    }
    const tenantId = this.deps.tenantId ?? null;
    try {
      await storage.customerProviderBindings.create({
        customerId,
        provider: providerName,
        providerCustomerId,
      });
    } catch (error) {
      const raced = await storage.customerProviderBindings.findByCustomerAndProvider(
        customerId,
        providerName,
        tenantId,
      );
      if (!raced) {
        throw new CustomerProviderBindingPersistenceError(providerName, providerCustomerId, {
          cause: error,
        });
      }
      if (raced.providerCustomerId !== providerCustomerId) {
        throw new CustomerProviderBindingConflictError(
          providerName,
          providerCustomerId,
          raced.providerCustomerId,
          { cause: error },
        );
      }
    }
  }
}
