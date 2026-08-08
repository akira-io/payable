import type { SubscriptionProviderBinding } from '../../../domain/entities/subscription-provider-binding.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import type { LocalDependencies } from '../../builders/local-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { isUniqueConstraintViolation } from '../storage/is-unique-constraint-violation';

export interface AttachCanonicalSubscriptionProviderInput {
  provider: string;
  providerSubscriptionId: string;
  authorization?: AuthorizationContext;
}

export async function attachCanonicalSubscriptionProvider(
  dependencies: LocalDependencies,
  subscriptionId: string,
  input: AttachCanonicalSubscriptionProviderInput,
): Promise<SubscriptionProviderBinding> {
  const storage = dependencies.storage;
  if (!storage) {
    throw new PayableError('Canonical subscription management requires a storage driver', {
      code: 'SUBSCRIPTION_STORAGE_REQUIRED',
    });
  }
  const tenantId = dependencies.tenantId ?? null;
  const subscription = await storage.subscriptions.findById(subscriptionId, tenantId);
  if (!subscription) {
    throw new PayableError(`Subscription not found: ${subscriptionId}`, {
      code: 'SUBSCRIPTION_NOT_FOUND',
    });
  }
  const provider = input.provider.trim();
  const providerSubscriptionId = input.providerSubscriptionId.trim();
  if (!provider || !providerSubscriptionId) {
    throw new PayableError('Provider and provider subscription id are required', {
      code: 'SUBSCRIPTION_PROVIDER_BINDING_INVALID',
    });
  }
  const existing = await storage.subscriptionProviderBindings.findBySubscriptionAndProvider(
    subscription.id,
    provider,
    tenantId,
  );
  if (existing) {
    if (existing.providerSubscriptionId === providerSubscriptionId) return existing;
    throw new PayableError('A provider binding already exists for this subscription', {
      code: 'SUBSCRIPTION_PROVIDER_BINDING_CONFLICT',
      context: { subscriptionId, provider },
    });
  }
  const correlationId = CorrelationId.generate().toString();
  try {
    return await storage.transaction(async (repositories) => {
      const binding = await repositories.subscriptionProviderBindings.create({
        tenantId,
        subscriptionId: subscription.id,
        provider,
        providerSubscriptionId,
        providerSyncedAt: null,
      });
      await repositories.auditLogs.create({
        tenantId,
        correlationId,
        actorType: input.authorization?.actorType ?? null,
        actorId: input.authorization?.actorId ?? null,
        action: 'subscription.provider-attached',
        resourceType: 'subscription',
        resourceId: subscription.id,
        before: null,
        after: { provider, providerSubscriptionId },
        metadata: { source: subscription.creationSource },
        ipAddress: null,
        userAgent: null,
      });
      await repositories.outboxEvents.create({
        tenantId,
        correlationId,
        eventType: 'subscription.provider-attached.v1',
        eventVersion: 1,
        payload: { subscriptionId, provider, providerSubscriptionId, tenantId },
        dedupeKey: `subscription:provider-attached:${binding.id}`,
      });
      return binding;
    });
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;
    const duplicate = await storage.subscriptionProviderBindings.findBySubscriptionAndProvider(
      subscription.id,
      provider,
      tenantId,
    );
    if (duplicate?.providerSubscriptionId === providerSubscriptionId) return duplicate;
    throw new PayableError('A provider binding conflicts with an existing identity', {
      code: 'SUBSCRIPTION_PROVIDER_BINDING_CONFLICT',
      context: { subscriptionId, provider },
      cause: error,
    });
  }
}
