import {
  type CustomerCapable,
  isCustomerCapable,
  type PaymentProvider,
} from '../../../domain/contracts/payment-provider.contract';
import type { Customer } from '../../../domain/entities/customer.entity';
import type { CustomerProviderBinding } from '../../../domain/entities/customer-provider-binding.entity';
import type { CustomerProviderSyncState } from '../../../domain/entities/customer-provider-sync-state.entity';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { CustomerProviderBindingWriter } from '../../services/customers/customer-provider-binding-writer';
import { CustomerProviderSyncLifecycle } from '../../services/customers/customer-provider-sync-lifecycle';
import { assertCapableProvider } from '../../services/provider-capabilities/assert-provider-capability';
import { EnsureCustomerAction } from './ensure-customer.action';
import { normalizeCustomerEmail } from './normalize-customer-email';

export class SyncCustomerWithProviderAction {
  private readonly lifecycle: CustomerProviderSyncLifecycle;

  constructor(private readonly dependencies: BillingDependencies) {
    this.lifecycle = new CustomerProviderSyncLifecycle(dependencies);
  }

  async handle(billable: Billable): Promise<string> {
    const provider = this.dependencies.provider;
    assertCapableProvider(provider, 'customers', isCustomerCapable);
    const local = await this.prepareLocalCustomer(billable);
    if (
      local?.previous?.status === 'reconciliation_required' &&
      local.previous.providerCustomerId
    ) {
      return this.reconcile(local);
    }
    if (local?.binding) {
      return this.updateProvider(local);
    }
    return this.createProviderCustomer(billable, local);
  }

  private async prepareLocalCustomer(billable: Billable): Promise<LocalSyncContext | null> {
    const storage = this.dependencies.storage;
    if (!storage) {
      return null;
    }
    const tenantId = this.tenantId();
    const customer = await new EnsureCustomerAction(this.dependencies).handle(billable);
    const previous = await storage.customerProviderSyncStates.findByCustomerAndProvider(
      customer.id,
      this.dependencies.providerName,
      tenantId,
    );
    const attempts = await this.lifecycle.begin(customer.id, previous);
    const binding = await storage.customerProviderBindings.findByCustomerAndProvider(
      customer.id,
      this.dependencies.providerName,
      tenantId,
    );
    return { customer, previous, attempts, binding };
  }

  private async reconcile(context: LocalSyncContext): Promise<string> {
    const providerCustomerId = context.previous?.providerCustomerId;
    if (!providerCustomerId) {
      throw new Error('Reconciliation state is missing its provider customer id');
    }
    try {
      if (!context.binding) {
        await this.bindingWriter().persist(context.customer.id, providerCustomerId);
      }
      if (context.binding?.providerCustomerId !== providerCustomerId && context.binding) {
        await this.bindingWriter().persist(context.customer.id, providerCustomerId);
      }
      await this.lifecycle.synchronized(context.customer.id, providerCustomerId, context.attempts);
      return providerCustomerId;
    } catch (error) {
      await this.lifecycle.reconciliationRequired(
        context.customer.id,
        providerCustomerId,
        context.attempts,
        error,
      );
      throw error;
    }
  }

  private async updateProvider(context: LocalSyncContext): Promise<string> {
    const binding = context.binding;
    if (!binding) {
      throw new Error('Customer provider binding disappeared before update');
    }
    const providerCustomerId = binding.providerCustomerId;
    const key = IdempotencyKey.of(
      `${this.customerKey(context.customer).toString()}:update:${context.customer.updatedAt.toISOString()}`,
    );
    let remoteUpdated = false;
    try {
      await this.customerProvider().updateCustomer(
        {
          providerCustomerId,
          email: context.customer.email,
          name: context.customer.name ?? undefined,
        },
        operationContext(key),
      );
      remoteUpdated = true;
      await this.lifecycle.synchronized(context.customer.id, providerCustomerId, context.attempts);
      return providerCustomerId;
    } catch (error) {
      if (remoteUpdated) {
        await this.lifecycle.reconciliationRequired(
          context.customer.id,
          providerCustomerId,
          context.attempts,
          error,
        );
      } else {
        await this.lifecycle.failed(
          context.customer.id,
          context.attempts,
          error,
          providerCustomerId,
        );
      }
      throw error;
    }
  }

  private async createProviderCustomer(
    billable: Billable,
    local: LocalSyncContext | null,
  ): Promise<string> {
    const customerInput = local
      ? {
          email: local.customer.email,
          name: local.customer.name ?? undefined,
          billableType: local.customer.billableType,
          billableId: local.customer.billableId,
        }
      : {
          email: normalizeCustomerEmail(billable.email),
          name: billable.name,
          billableType: billable.billableType,
          billableId: billable.billableId,
        };
    const key = local
      ? this.customerKey(local.customer)
      : IdempotencyKey.forCustomer({
          tenantId: this.tenantId(),
          provider: this.dependencies.providerName,
          billableType: billable.billableType,
          billableId: billable.billableId,
        });
    let remoteProviderCustomerId: string | null = null;
    const run = async (): Promise<string> => {
      const dto = await this.customerProvider().createCustomer(
        customerInput,
        operationContext(key),
      );
      remoteProviderCustomerId = dto.providerCustomerId;
      if (local) {
        await this.bindingWriter().persist(local.customer.id, dto.providerCustomerId);
        await this.lifecycle.synchronized(
          local.customer.id,
          dto.providerCustomerId,
          local.attempts,
        );
      }
      return dto.providerCustomerId;
    };
    try {
      return await this.executeCreateIdempotently(key, billable, run);
    } catch (error) {
      if (!local) {
        throw error;
      }
      if (remoteProviderCustomerId) {
        await this.lifecycle.reconciliationRequired(
          local.customer.id,
          remoteProviderCustomerId,
          local.attempts,
          error,
        );
        throw error;
      }
      await this.lifecycle.failed(local.customer.id, local.attempts, error);
      throw error;
    }
  }

  private executeCreateIdempotently(
    key: IdempotencyKey,
    billable: Billable,
    run: () => Promise<string>,
  ): Promise<string> {
    const idempotency = this.dependencies.idempotency;
    if (!idempotency) {
      return run();
    }
    return idempotency.execute({
      key: key.toString(),
      scope: 'customer',
      operation: 'sync',
      request: { billableType: billable.billableType, billableId: billable.billableId },
      resourceType: 'customer',
      tenantId: this.dependencies.tenantId,
      run,
    });
  }

  private bindingWriter(): CustomerProviderBindingWriter {
    const storage = this.dependencies.storage;
    if (!storage) {
      throw new Error('Customer provider binding storage is unavailable');
    }
    return new CustomerProviderBindingWriter(
      storage.customerProviderBindings,
      this.dependencies.providerName,
      this.tenantId(),
    );
  }

  private customerKey(customer: Customer): IdempotencyKey {
    return IdempotencyKey.forCustomer({
      tenantId: this.tenantId(),
      provider: this.dependencies.providerName,
      billableType: customer.billableType,
      billableId: customer.billableId,
    });
  }

  private customerProvider(): PaymentProvider & CustomerCapable {
    const provider = this.dependencies.provider;
    assertCapableProvider(provider, 'customers', isCustomerCapable);
    return provider;
  }

  private tenantId(): string | null {
    return this.dependencies.tenantId ?? null;
  }
}

interface LocalSyncContext {
  customer: Customer;
  previous: CustomerProviderSyncState | null;
  attempts: number;
  binding: CustomerProviderBinding | null;
}

function operationContext(key: IdempotencyKey): {
  correlationId: string;
  idempotencyKey: string;
} {
  return {
    correlationId: CorrelationId.generate().toString(),
    idempotencyKey: key.toString(),
  };
}
