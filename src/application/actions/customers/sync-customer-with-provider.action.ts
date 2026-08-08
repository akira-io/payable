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
import {
  type CustomerProviderSyncAttempt,
  CustomerProviderSyncLifecycle,
} from '../../services/customers/customer-provider-sync-lifecycle';
import {
  assertDurableCustomerCreate,
  awaitCustomerProviderSync,
  customerUpdateIdempotencyKey,
  requiresManualCreateReconciliation,
  unresolvedCustomerReconciliationError,
} from '../../services/customers/customer-provider-sync-reliability';
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
    if (local && !local.attempt.acquired) {
      const providerCustomerId = await awaitCustomerProviderSync(
        this.dependencies,
        local.customer.id,
        local.attempt,
      );
      return providerCustomerId ?? this.handle(billable);
    }
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
    const bindingBeforeClaim = await storage.customerProviderBindings.findByCustomerAndProvider(
      customer.id,
      this.dependencies.providerName,
      tenantId,
    );
    const attempt = await this.lifecycle.begin(customer.id, bindingBeforeClaim !== null);
    const previous = attempt.previous;
    const bindingChangedDuringClaim =
      previous?.status === 'synchronized' ||
      (!attempt.acquired && previous?.status === 'reconciliation_required');
    const binding =
      !bindingBeforeClaim && bindingChangedDuringClaim
        ? await storage.customerProviderBindings.findByCustomerAndProvider(
            customer.id,
            this.dependencies.providerName,
            tenantId,
          )
        : bindingBeforeClaim;
    if (
      previous?.status === 'reconciliation_required' &&
      !previous.providerCustomerId &&
      !binding
    ) {
      throw unresolvedCustomerReconciliationError(
        customer.id,
        this.dependencies.providerName,
        previous.failureCode,
      );
    }
    return { customer, previous, attempt, binding };
  }

  private async reconcile(context: LocalSyncContext): Promise<string> {
    const providerCustomerId = context.previous?.providerCustomerId;
    if (!providerCustomerId) {
      throw new Error('Reconciliation state is missing its provider customer id');
    }
    if (context.binding && context.binding.providerCustomerId !== providerCustomerId) {
      return this.updateProvider(context);
    }
    try {
      if (!context.binding) {
        await this.bindingWriter().persist(context.customer.id, providerCustomerId);
      }
      await this.lifecycle.synchronized(context.customer.id, providerCustomerId, context.attempt);
      return providerCustomerId;
    } catch (error) {
      await this.lifecycle.reconciliationRequired(
        context.customer.id,
        providerCustomerId,
        context.attempt,
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
    const key = await customerUpdateIdempotencyKey(
      context.customer,
      this.dependencies.providerName,
      providerCustomerId,
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
      await this.lifecycle.synchronized(context.customer.id, providerCustomerId, context.attempt);
      return providerCustomerId;
    } catch (error) {
      if (remoteUpdated) {
        await this.lifecycle.reconciliationRequired(
          context.customer.id,
          providerCustomerId,
          context.attempt,
          error,
          context.previous?.synchronizedAt ?? null,
        );
      } else {
        await this.lifecycle.failed(
          context.customer.id,
          context.attempt,
          error,
          providerCustomerId,
          context.previous?.synchronizedAt ?? null,
        );
      }
      throw error;
    }
  }

  private async createProviderCustomer(
    billable: Billable,
    local: LocalSyncContext | null,
  ): Promise<string> {
    assertDurableCustomerCreate(this.customerProvider(), this.dependencies);
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
        await this.lifecycle.synchronized(local.customer.id, dto.providerCustomerId, local.attempt);
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
          local.attempt,
          error,
        );
        throw error;
      }
      if (requiresManualCreateReconciliation(this.customerProvider(), error)) {
        await this.lifecycle.reconciliationRequired(local.customer.id, null, local.attempt, error);
      } else {
        await this.lifecycle.failed(local.customer.id, local.attempt, error);
      }
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
  attempt: CustomerProviderSyncAttempt;
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
