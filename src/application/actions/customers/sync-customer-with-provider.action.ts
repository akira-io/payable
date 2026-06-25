import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { Email } from '../../../domain/value-objects/email';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';

export class SyncCustomerWithProviderAction {
  constructor(private readonly deps: BillingDependencies) {}

  async handle(billable: Billable): Promise<string> {
    const { provider, providerName, storage, idempotency } = this.deps;
    const tenantId = this.deps.tenantId ?? null;
    const email = Email.of(billable.email).toString();
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
      await this.persist(billable, dto.providerCustomerId, email);
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

  private async persist(
    billable: Billable,
    providerCustomerId: string,
    email: string,
  ): Promise<void> {
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
      await storage.customers.update(existing.id, { providerCustomerId }, tenantId);
      return;
    }
    try {
      await storage.customers.create({
        tenantId,
        provider: providerName,
        providerCustomerId,
        billableType: billable.billableType,
        billableId: billable.billableId,
        email,
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
      await storage.customers.update(raced.id, { providerCustomerId }, tenantId);
    }
  }
}
