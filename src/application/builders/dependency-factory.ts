import { PayableError } from '../../domain/errors/payable-error';
import { ProviderNotFoundError } from '../../domain/errors/provider-not-found.error';
import type { ProviderRegistry } from '../../provider-registry';
import type { ResolvedConfig } from '../../support/config/payable-config';
import type { TreasuryProviderRegistry } from '../../treasury-provider-registry';
import { IdempotencyService } from '../services/idempotency/idempotency-service';
import type { BillingDependencies } from './billing-dependencies';
import type { TreasuryWebhookDependencies } from './treasury-webhook-dependencies';
import type { WebhookDependencies } from './webhook-dependencies';

export class DependencyFactory {
  constructor(
    private readonly resolved: ResolvedConfig,
    private readonly registry: ProviderRegistry,
    private readonly treasuryRegistry: TreasuryProviderRegistry,
  ) {}

  billing(providerName?: string, tenantId?: string | null): BillingDependencies {
    const name = providerName ?? this.registry.names()[0];
    if (!name) {
      throw new ProviderNotFoundError(providerName ?? 'default');
    }
    this.assertTenant(tenantId);
    return {
      provider: this.registry.get(name),
      providerName: name,
      clock: this.resolved.clock,
      storage: this.resolved.storage,
      tenantId: tenantId ?? null,
      authorizationEnabled: this.resolved.authorizationEnabled,
      idempotency: this.idempotencyService(),
      logger: this.resolved.logger,
    };
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
    if (this.resolved.tenantEnabled && (tenantId === undefined || tenantId === null)) {
      throw new PayableError('A tenant id is required when tenancy is enabled', {
        code: 'TENANT_REQUIRED',
      });
    }
  }

  private idempotencyService(): IdempotencyService | undefined {
    const { enabled, strategy, store } = this.resolved.idempotency;
    if (!enabled || strategy === 'manual' || !store) {
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
