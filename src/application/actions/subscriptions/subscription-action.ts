import type {
  Repositories,
  StorageDriver,
} from '../../../domain/contracts/storage-driver.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import type { Subscription } from '../../../domain/entities/subscription.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { SubscriptionNotFoundError } from '../../../domain/errors/subscription-not-found.error';
import { reconcileSubscriptionStatus } from '../../../domain/states/subscription-state-machine';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { SubscriptionStatus } from '../../../domain/value-objects/subscription-status';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import { assertAuthorized } from '../../policies/assert-authorized';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { FindSubscriptionQuery } from '../../queries/subscriptions/find-subscription.query';
import { assertProviderCapability } from '../../services/provider-capabilities/assert-provider-capability';

export type ManagedSubscription = Subscription & { providerSubscriptionId: string };

export abstract class SubscriptionAction {
  constructor(protected readonly deps: BillingDependencies) {}

  protected authorize(
    authorize: (context: AuthorizationContext) => boolean,
    context: AuthorizationContext | undefined,
    action: string,
  ): void {
    assertAuthorized(this.deps.authorizationEnabled ?? false, authorize, context, action);
  }

  protected storage(): StorageDriver {
    if (!this.deps.storage) {
      throw new PayableError('Subscription management requires a storage driver', {
        code: 'SUBSCRIPTION_STORAGE_REQUIRED',
      });
    }
    return this.deps.storage;
  }

  protected async auditWith(
    repos: Repositories,
    input: {
      action: string;
      subscriptionId: string;
      before: Record<string, unknown>;
      after: Record<string, unknown>;
      authorization?: AuthorizationContext;
    },
  ): Promise<void> {
    await repos.auditLogs.create({
      tenantId: this.deps.tenantId ?? null,
      correlationId: CorrelationId.generate().toString(),
      actorType: input.authorization?.actorType ?? null,
      actorId: input.authorization?.actorId ?? null,
      action: input.action,
      resourceType: 'subscription',
      resourceId: input.subscriptionId,
      before: input.before,
      after: input.after,
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });
  }

  protected async resolve(billable: Billable, name: string): Promise<ManagedSubscription> {
    assertProviderCapability(this.deps.provider, 'subscriptions');
    this.storage();
    const subscription = await new FindSubscriptionQuery(this.deps).run(billable, name);
    if (!subscription?.providerSubscriptionId) {
      throw new SubscriptionNotFoundError(name);
    }
    return subscription as ManagedSubscription;
  }

  protected reconcileStatus(
    current: SubscriptionStatus,
    providerStatus: SubscriptionStatus,
  ): SubscriptionStatus {
    return reconcileSubscriptionStatus(current, providerStatus).status;
  }

  protected assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new PayableError(`Subscription quantity must be a positive integer, got ${quantity}`, {
        code: 'SUBSCRIPTION_INVALID_QUANTITY',
        context: { quantity },
      });
    }
  }

  protected context(
    operation: string,
    providerSubscriptionId: string,
    discriminator?: string,
    perAttempt = false,
  ): OperationContext {
    const correlationId = CorrelationId.generate().toString();
    return {
      correlationId,
      idempotencyKey: IdempotencyKey.forSubscriptionOperation({
        tenantId: this.deps.tenantId ?? null,
        operation,
        provider: this.deps.providerName,
        providerSubscriptionId,
        discriminator,
        nonce: perAttempt ? correlationId : undefined,
      }).toString(),
    };
  }
}
