import type { Subscription } from '../../domain/entities/subscription.entity';
import type { SubscriptionProviderBinding } from '../../domain/entities/subscription-provider-binding.entity';
import { CustomerNotFoundError } from '../../domain/errors/customer-not-found.error';
import { PayableError } from '../../domain/errors/payable-error';
import { CorrelationId } from '../../domain/value-objects/correlation-id';
import type { AuthorizationContext } from '../policies/authorization-context';
import { isUniqueConstraintViolation } from '../services/storage/is-unique-constraint-violation';
import {
  type AttachCanonicalSubscriptionProviderInput,
  attachCanonicalSubscriptionProvider,
} from '../services/subscriptions/attach-canonical-subscription-provider';
import {
  type CanonicalSubscriptionActivation,
  resolveInitialCanonicalSubscriptionLifecycle,
} from '../services/subscriptions/canonical-subscription-lifecycle';
import type { LocalDependencies } from './local-dependencies';

export interface CreateCanonicalSubscriptionInput {
  customerId: string;
  name: string;
  priceId: string;
  quantity?: number;
  activation: CanonicalSubscriptionActivation;
  collectionResponsibility: 'merchant';
  source: string;
  authorization?: AuthorizationContext;
}

export type { AttachCanonicalSubscriptionProviderInput };

export class CanonicalSubscriptionResource {
  constructor(private readonly dependencies: LocalDependencies) {}

  async create(input: CreateCanonicalSubscriptionInput): Promise<Subscription> {
    const storage = this.dependencies.storage;
    if (!storage?.canonicalPrices) {
      throw new PayableError('Canonical subscription management requires a storage driver', {
        code: 'SUBSCRIPTION_STORAGE_REQUIRED',
      });
    }
    const tenantId = this.dependencies.tenantId ?? null;
    const quantity = input.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new PayableError('Subscription quantity must be a positive integer', {
        code: 'SUBSCRIPTION_QUANTITY_INVALID',
      });
    }
    if (!input.name.trim()) {
      throw new PayableError('Subscription name is required', {
        code: 'SUBSCRIPTION_NAME_INVALID',
      });
    }
    if (!input.source.trim()) {
      throw new PayableError('Subscription creation source is required', {
        code: 'SUBSCRIPTION_SOURCE_INVALID',
      });
    }

    const customer = await storage.customers.findById(input.customerId, tenantId);
    if (!customer) throw new CustomerNotFoundError(input.customerId);
    const price = await storage.canonicalPrices.findById(input.priceId, tenantId);
    if (!price) {
      throw new PayableError(`Price not found: ${input.priceId}`, {
        code: 'PRICE_NOT_FOUND',
        context: { priceId: input.priceId },
      });
    }
    if (price.type !== 'recurring' || !price.interval || !price.intervalCount) {
      throw new PayableError('Canonical subscriptions require a recurring price', {
        code: 'SUBSCRIPTION_PRICE_NOT_RECURRING',
        context: { priceId: price.id },
      });
    }

    const lifecycle = resolveInitialCanonicalSubscriptionLifecycle(
      input.activation,
      price.interval,
      price.intervalCount,
    );
    const existing = await storage.subscriptions.findByName(customer.id, input.name, tenantId);
    if (existing) return this.resolveDuplicate(existing, input, quantity, lifecycle);
    if (!price.active) {
      throw new PayableError('Canonical subscriptions require an active price', {
        code: 'SUBSCRIPTION_PRICE_INACTIVE',
        context: { priceId: price.id },
      });
    }

    const correlationId = CorrelationId.generate().toString();
    try {
      return await storage.transaction(async (repositories) => {
        const lockedPrice = await repositories.canonicalPrices?.findActiveRecurringByIdForUpdate(
          price.id,
          tenantId,
        );
        if (!lockedPrice) {
          throw new PayableError('Canonical subscriptions require an active recurring price', {
            code: 'SUBSCRIPTION_PRICE_UNAVAILABLE',
            context: { priceId: price.id },
          });
        }
        const subscription = await repositories.subscriptions.create({
          tenantId,
          customerId: customer.id,
          name: input.name,
          provider: null,
          providerSubscriptionId: null,
          status: lifecycle.status,
          priceId: lockedPrice.id,
          quantity,
          canonicalPriceId: lockedPrice.id,
          acceptedCurrency: lockedPrice.currency,
          acceptedUnitAmount: lockedPrice.unitAmount,
          acceptedInterval: lockedPrice.interval,
          acceptedIntervalCount: lockedPrice.intervalCount,
          acceptedQuantity: quantity,
          collectionResponsibility: input.collectionResponsibility,
          creationSource: input.source,
          trialEndsAt: lifecycle.trialEndsAt,
          endsAt: null,
          currentPeriodStart: lifecycle.currentPeriodStart,
          currentPeriodEnd: lifecycle.currentPeriodEnd,
        });
        await repositories.subscriptionItems.createMany([
          {
            subscriptionId: subscription.id,
            priceId: lockedPrice.id,
            providerItemId: null,
            quantity,
          },
        ]);
        await repositories.auditLogs.create({
          tenantId,
          correlationId,
          actorType: input.authorization?.actorType ?? null,
          actorId: input.authorization?.actorId ?? null,
          action: 'subscription.created',
          resourceType: 'subscription',
          resourceId: subscription.id,
          before: null,
          after: { status: subscription.status, provider: null },
          metadata: {
            source: input.source,
            canonicalPriceId: lockedPrice.id,
            currency: lockedPrice.currency,
            unitAmount: lockedPrice.unitAmount,
            interval: lockedPrice.interval,
            intervalCount: lockedPrice.intervalCount,
            quantity,
            activation: input.activation.state,
            collectionResponsibility: input.collectionResponsibility,
          },
          ipAddress: null,
          userAgent: null,
        });
        await repositories.outboxEvents.create({
          tenantId,
          correlationId,
          eventType: 'subscription.created.v1',
          eventVersion: 1,
          payload: {
            subscriptionId: subscription.id,
            customerId: customer.id,
            actor: {
              type: input.authorization?.actorType ?? null,
              id: input.authorization?.actorId ?? null,
            },
            source: input.source,
            tenantId,
            acceptedTerms: {
              canonicalPriceId: lockedPrice.id,
              currency: lockedPrice.currency,
              unitAmount: lockedPrice.unitAmount,
              interval: lockedPrice.interval,
              intervalCount: lockedPrice.intervalCount,
              quantity,
            },
            lifecycle: {
              transition: 'created',
              status: subscription.status,
              currentPeriodStart: subscription.currentPeriodStart?.toISOString() ?? null,
              currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
              trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
              collectionResponsibility: input.collectionResponsibility,
            },
          },
          dedupeKey: `subscription:created:${subscription.id}`,
        });
        return subscription;
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) throw error;
      const duplicate = await storage.subscriptions.findByName(customer.id, input.name, tenantId);
      if (!duplicate) throw error;
      return this.resolveDuplicate(duplicate, input, quantity, lifecycle);
    }
  }

  async attachProvider(
    subscriptionId: string,
    input: AttachCanonicalSubscriptionProviderInput,
  ): Promise<SubscriptionProviderBinding> {
    return attachCanonicalSubscriptionProvider(this.dependencies, subscriptionId, input);
  }

  private resolveDuplicate(
    existing: Subscription,
    input: CreateCanonicalSubscriptionInput,
    quantity: number,
    lifecycle: Pick<
      Subscription,
      'status' | 'trialEndsAt' | 'currentPeriodStart' | 'currentPeriodEnd'
    >,
  ): Subscription {
    if (
      existing.canonicalPriceId === input.priceId &&
      existing.acceptedQuantity === quantity &&
      existing.provider === null &&
      existing.collectionResponsibility === input.collectionResponsibility &&
      existing.creationSource === input.source &&
      existing.status === lifecycle.status &&
      sameInstant(existing.trialEndsAt, lifecycle.trialEndsAt) &&
      sameInstant(existing.currentPeriodStart, lifecycle.currentPeriodStart) &&
      sameInstant(existing.currentPeriodEnd, lifecycle.currentPeriodEnd)
    ) {
      return existing;
    }
    throw new PayableError('A subscription with this logical identity already exists', {
      code: 'SUBSCRIPTION_IDENTITY_CONFLICT',
      context: { customerId: existing.customerId, name: existing.name },
    });
  }
}

function sameInstant(left: Date | null, right: Date | null): boolean {
  return left?.getTime() === right?.getTime();
}
