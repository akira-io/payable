import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import type { Subscription } from '../../domain/entities/subscription.entity';
import type { AuthorizationContext } from '../policies/authorization-context';
import { resolveLocalSubscription } from '../services/subscriptions/resolve-local-subscription';
import type { BillingDependencies } from './billing-dependencies';
import {
  SubscriptionManager,
  type SwapOptions,
  type UpdateQuantityOptions,
} from './subscription-manager';

export class LocalSubscriptionResource {
  constructor(
    private readonly storage: StorageDriver,
    private readonly localId: string,
    private readonly tenantId: string | null,
    private readonly billingDependencies: (providerName: string) => BillingDependencies,
  ) {}

  async retrieve(): Promise<Subscription> {
    const resolved = await resolveLocalSubscription(this.storage, this.localId, this.tenantId);
    return resolved.subscription;
  }

  get(): Promise<Subscription> {
    return this.retrieve();
  }

  swap(priceId: string, authorization?: AuthorizationContext): Promise<Subscription>;
  swap(options: SwapOptions): Promise<Subscription>;
  async swap(
    priceIdOrOptions: string | SwapOptions,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    if (typeof priceIdOrOptions === 'string') {
      await manager.swap(priceIdOrOptions, authorization);
    } else {
      await manager.swap(priceIdOrOptions);
    }
    return this.retrieve();
  }

  updateQuantity(quantity: number, authorization?: AuthorizationContext): Promise<Subscription>;
  updateQuantity(options: UpdateQuantityOptions): Promise<Subscription>;
  async updateQuantity(
    quantityOrOptions: number | UpdateQuantityOptions,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    if (typeof quantityOrOptions === 'number') {
      await manager.updateQuantity(quantityOrOptions, authorization);
    } else {
      await manager.updateQuantity(quantityOrOptions);
    }
    return this.retrieve();
  }

  async cancel(authorization?: AuthorizationContext): Promise<Subscription> {
    const manager = await this.manager();
    await manager.cancel(authorization);
    return this.retrieve();
  }

  async cancelNow(authorization?: AuthorizationContext): Promise<Subscription> {
    const manager = await this.manager();
    await manager.cancelNow(authorization);
    return this.retrieve();
  }

  async pause(authorization?: AuthorizationContext): Promise<Subscription> {
    const manager = await this.manager();
    await manager.pause(authorization);
    return this.retrieve();
  }

  async resume(authorization?: AuthorizationContext): Promise<Subscription> {
    const manager = await this.manager();
    await manager.resume(authorization);
    return this.retrieve();
  }

  private async manager(): Promise<SubscriptionManager> {
    const { subscription, customer } = await resolveLocalSubscription(
      this.storage,
      this.localId,
      this.tenantId,
    );
    return new SubscriptionManager(
      {
        billableType: customer.billableType,
        billableId: customer.billableId,
        email: customer.email,
        name: customer.name ?? undefined,
      },
      subscription.name,
      this.billingDependencies(subscription.provider),
    );
  }
}
