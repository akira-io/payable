import { PayableError } from '../../domain/errors/payable-error';
import { ProviderNotFoundError } from '../../domain/errors/provider-not-found.error';
import type { ProviderRegistry } from '../../provider-registry';
import type { ResolvedConfig } from '../../support/config/payable-config';
import type { TreasuryProviderRegistry } from '../../treasury-provider-registry';
import { IdempotencyService } from '../services/idempotency/idempotency-service';
import { SubscriptionChangePreviewStore } from '../services/subscriptions/subscription-change-preview-store';
import type { BillingDependencies } from './billing-dependencies';
import { CustomerResource } from './customer-resource';
import type { LocalDependencies } from './local-dependencies';
import { LocalSubscriptionResource } from './local-subscription-resource';
import type { TreasuryWebhookDependencies } from './treasury-webhook-dependencies';
import type { WebhookDependencies } from './webhook-dependencies';

export class DependencyFactory {
  constructor(
    private readonly resolved: ResolvedConfig,
    private readonly registry: ProviderRegistry,
    private readonly treasuryRegistry: TreasuryProviderRegistry,
  ) {}

  local(tenantId?: string | null): LocalDependencies {
    this.assertTenant(tenantId);
    const configuredIdempotency = this.configuredIdempotencyService();
    const subscriptionChangePreviews = this.resolved.idempotency.store
      ? new SubscriptionChangePreviewStore(this.resolved.idempotency.store, this.resolved.clock)
      : undefined;
    return {
      clock: this.resolved.clock,
      storage: this.resolved.storage,
      tenantId: tenantId ?? null,
      authorizationEnabled: this.resolved.authorizationEnabled,
      idempotency:
        this.resolved.idempotency.strategy === 'manual' ? undefined : configuredIdempotency,
      catalogIdempotency: configuredIdempotency,
      subscriptionChangeIdempotency: configuredIdempotency,
      subscriptionChangePreviews,
      audit: this.resolved.storage?.auditLogs,
      events: this.resolved.events,
      logger: this.resolved.logger,
      locks: this.resolved.locks,
      resolveProvider: (providerName) => this.registry.get(providerName),
    };
  }

  billing(providerName?: string, tenantId?: string | null): BillingDependencies {
    const name = providerName ?? this.registry.names()[0];
    if (!name) {
      throw new ProviderNotFoundError(providerName ?? 'default');
    }
    const provider = this.registry.get(name);
    const local = this.local(tenantId);
    return {
      ...local,
      provider,
      providerName: name,
    };
  }

  customerResource(providerName?: string, tenantId?: string | null): CustomerResource {
    const local = this.local(tenantId);
    return new CustomerResource({
      storage: local.storage,
      tenantId: local.tenantId ?? null,
      providerName,
      resolveBillingDependencies: () => this.billing(providerName, tenantId),
    });
  }

  localSubscription(
    localId: string,
    tenantId?: string | null,
    providerName?: string,
  ): LocalSubscriptionResource {
    this.assertTenant(tenantId);
    const storage = this.resolved.storage;
    if (!storage) {
      throw new PayableError('Subscription management requires a storage driver', {
        code: 'SUBSCRIPTION_STORAGE_REQUIRED',
      });
    }
    return new LocalSubscriptionResource(
      storage,
      localId,
      tenantId ?? null,
      (resolvedProviderName) => this.billing(resolvedProviderName, tenantId),
      providerName,
    );
  }

  webhook(providerName?: string): WebhookDependencies {
    const name = providerName ?? this.defaultWebhookProvider();
    if (!this.resolved.storage) {
      throw new PayableError('Webhook processing requires a storage driver', {
        code: 'WEBHOOK_STORAGE_REQUIRED',
      });
    }
    return {
      provider: this.registry.get(name),
      providerName: name,
      storage: this.resolved.storage,
      queue: this.resolved.queue,
      events: this.resolved.events,
      clock: this.resolved.clock,
      tenantResolver: this.resolved.tenantResolver,
      tenantEnabled: this.resolved.tenantEnabled,
    };
  }

  treasuryWebhook(providerName?: string): TreasuryWebhookDependencies {
    const name = providerName ?? this.defaultTreasuryWebhookProvider();
    if (!this.resolved.storage) {
      throw new PayableError('Treasury webhook processing requires a storage driver', {
        code: 'WEBHOOK_STORAGE_REQUIRED',
      });
    }
    return {
      provider: this.treasuryRegistry.get(name),
      providerName: name,
      storage: this.resolved.storage,
      queue: this.resolved.queue,
      events: this.resolved.events,
      clock: this.resolved.clock,
      tenantResolver: this.resolved.tenantResolver,
      tenantEnabled: this.resolved.tenantEnabled,
    };
  }

  private assertTenant(tenantId?: string | null): void {
    if (
      this.resolved.tenantEnabled &&
      (tenantId === undefined || tenantId === null || tenantId.trim().length === 0)
    ) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
  }

  private configuredIdempotencyService(): IdempotencyService | undefined {
    const { enabled, store } = this.resolved.idempotency;
    if (!enabled || !store) {
      return undefined;
    }
    return new IdempotencyService(store, this.resolved.clock);
  }

  private defaultWebhookProvider(): string {
    const names = this.registry.names();
    if (names.length > 1) {
      throw new PayableError(
        'Multiple providers are registered; route the webhook to /webhooks/:provider',
        { code: 'WEBHOOK_PROVIDER_AMBIGUOUS' },
      );
    }
    const name = names[0];
    if (!name) {
      throw new ProviderNotFoundError('default');
    }
    return name;
  }

  private defaultTreasuryWebhookProvider(): string {
    const names = this.treasuryRegistry.names();
    if (names.length > 1) {
      throw new PayableError('Multiple Treasury providers are registered; specify a provider', {
        code: 'TREASURY_WEBHOOK_PROVIDER_AMBIGUOUS',
      });
    }
    const name = names[0];
    if (!name) {
      return 'default';
    }
    return name;
  }
}
