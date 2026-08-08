import type { StorageDriver } from '../../domain/contracts/storage-driver.contract';
import { resolveSubscriptionOperationCapabilities } from '../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type {
  ApplySubscriptionChangeInput,
  PreviewSubscriptionChangeInput,
  SubscriptionChangePreview,
} from '../../domain/dtos/subscription-change.dto';
import type { SubscriptionOperationCapabilities } from '../../domain/dtos/subscription-operation-capabilities.dto';
import type {
  PausePaymentCollectionPolicy,
  PauseSubscriptionPolicy,
  ResumePausedSubscriptionPolicy,
} from '../../domain/dtos/subscription-pause-policy.dto';
import type { Subscription } from '../../domain/entities/subscription.entity';
import { PayableError } from '../../domain/errors/payable-error';
import type { AuthorizationContext } from '../policies/authorization-context';
import { resolveLocalSubscription } from '../services/subscriptions/resolve-local-subscription';
import type { BillingDependencies } from './billing-dependencies';
import {
  SubscriptionManager,
  type SwapOptions,
  type UpdateQuantityOptions,
} from './subscription-manager';

export interface LocalSubscriptionCapabilities {
  local: Readonly<{ retrieve: true; attachProvider: true }>;
  providerOperations: ReadonlyArray<{
    provider: string;
    bindingId: string;
    available: boolean;
    capabilities: SubscriptionOperationCapabilities | null;
  }>;
}

export class LocalSubscriptionResource {
  constructor(
    private readonly storage: StorageDriver,
    private readonly localId: string,
    private readonly tenantId: string | null,
    private readonly billingDependencies: (providerName: string) => BillingDependencies,
    private readonly selectedProviderName?: string,
  ) {}

  async retrieve(): Promise<Subscription> {
    const resolved = await resolveLocalSubscription(this.storage, this.localId, this.tenantId);
    return resolved.subscription;
  }

  get(): Promise<Subscription> {
    return this.retrieve();
  }

  async capabilities(): Promise<LocalSubscriptionCapabilities> {
    const subscription = await this.retrieve();
    const bindings = await this.storage.subscriptionProviderBindings.listBySubscriptionId(
      subscription.id,
      this.tenantId,
    );
    return {
      local: { retrieve: true, attachProvider: true },
      providerOperations: bindings.map((binding) => {
        try {
          const dependencies = this.billingDependencies(binding.provider);
          return {
            provider: binding.provider,
            bindingId: binding.id,
            available: true,
            capabilities: resolveSubscriptionOperationCapabilities(dependencies.provider),
          };
        } catch {
          return {
            provider: binding.provider,
            bindingId: binding.id,
            available: false,
            capabilities: null,
          };
        }
      }),
    };
  }

  async previewChange(
    input: PreviewSubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<SubscriptionChangePreview> {
    const manager = await this.manager();
    return manager.previewChange(input, authorization);
  }

  async applyChange(
    input: ApplySubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    await manager.applyChange(input, authorization);
    return this.retrieve();
  }

  async swap(options: SwapOptions): Promise<Subscription> {
    const manager = await this.manager();
    await manager.swap(options);
    return this.retrieve();
  }

  async updateQuantity(options: UpdateQuantityOptions): Promise<Subscription> {
    const manager = await this.manager();
    await manager.updateQuantity(options);
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

  async pauseSubscription(
    policy: PauseSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    await manager.pauseSubscription(policy, authorization);
    return this.retrieve();
  }

  async resumePausedSubscription(
    policy: ResumePausedSubscriptionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    await manager.resumePausedSubscription(policy, authorization);
    return this.retrieve();
  }

  async pausePaymentCollection(
    policy: PausePaymentCollectionPolicy,
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    await manager.pausePaymentCollection(policy, authorization);
    return this.retrieve();
  }

  async resumePaymentCollection(authorization?: AuthorizationContext): Promise<Subscription> {
    const manager = await this.manager();
    await manager.resumePaymentCollection(authorization);
    return this.retrieve();
  }

  async cancelScheduledSubscriptionChange(
    authorization?: AuthorizationContext,
  ): Promise<Subscription> {
    const manager = await this.manager();
    await manager.cancelScheduledSubscriptionChange(authorization);
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
    const bindings = await this.storage.subscriptionProviderBindings.listBySubscriptionId(
      subscription.id,
      this.tenantId,
    );
    const selectedBinding = this.selectedProviderName
      ? bindings.find(({ provider }) => provider === this.selectedProviderName)
      : bindings[0];
    const providerName = selectedBinding?.provider;
    if (!providerName) {
      throw new PayableError('A provider binding is required for this subscription operation', {
        code: 'SUBSCRIPTION_PROVIDER_BINDING_REQUIRED',
        context: { subscriptionId: subscription.id },
      });
    }
    if (!this.selectedProviderName && bindings.length > 1) {
      throw new PayableError('Select a provider before mutating this subscription', {
        code: 'SUBSCRIPTION_PROVIDER_BINDING_AMBIGUOUS',
        context: { subscriptionId: subscription.id },
      });
    }
    return new SubscriptionManager(
      {
        billableType: customer.billableType,
        billableId: customer.billableId,
        email: customer.email,
        name: customer.name ?? undefined,
      },
      subscription.name,
      this.billingDependencies(providerName),
    );
  }
}
