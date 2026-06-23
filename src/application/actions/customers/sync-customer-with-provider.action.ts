import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class SyncCustomerWithProviderAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable): Promise<string> {
    const { provider, providerName, storage } = this.deps;
    const tenantId = this.deps.tenantId ?? null;
    if (storage) {
      const existing = await storage.customers.findByBillable(
        billable.billableType,
        billable.billableId,
        tenantId,
      );
      if (existing?.providerCustomerId) {
        return existing.providerCustomerId;
      }
    }
    const key = IdempotencyKey.forCustomer({
      provider: providerName,
      billableType: billable.billableType,
      billableId: billable.billableId,
    });
    const dto = await provider.createCustomer(
      {
        email: billable.email,
        name: billable.name,
        billableType: billable.billableType,
        billableId: billable.billableId,
      },
      {
        correlationId: CorrelationId.generate().toString(),
        idempotencyKey: key.toString(),
      },
    );
    await this.persist(billable, dto.providerCustomerId);
    return dto.providerCustomerId;
  }

  private async persist(billable: Billable, providerCustomerId: string): Promise<void> {
    const { storage, providerName } = this.deps;
    if (!storage) {
      return;
    }
    const tenantId = this.deps.tenantId ?? null;
    const existing = await storage.customers.findByBillable(
      billable.billableType,
      billable.billableId,
      tenantId,
    );
    if (existing) {
      await storage.customers.update(existing.id, { providerCustomerId });
      return;
    }
    try {
      await storage.customers.create({
        tenantId,
        provider: providerName,
        providerCustomerId,
        billableType: billable.billableType,
        billableId: billable.billableId,
        email: billable.email,
        name: billable.name ?? null,
        metadata: null,
      });
    } catch (error) {
      const raced = await storage.customers.findByBillable(
        billable.billableType,
        billable.billableId,
        tenantId,
      );
      if (!raced) {
        throw error;
      }
      await storage.customers.update(raced.id, { providerCustomerId });
    }
  }
}
