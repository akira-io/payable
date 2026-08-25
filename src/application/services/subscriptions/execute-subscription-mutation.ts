import type {
  Repositories,
  StorageDriver,
} from '../../../domain/contracts/storage-driver.contract';
import type {
  SubscriptionMutationIntentBlob,
  SubscriptionMutationOperation,
} from '../../../domain/contracts/subscription-mutation-claim-repository.contract';
import type { OperationContext } from '../../../domain/dtos/common.dto';
import {
  acquireSubscriptionMutationClaim,
  ambiguousSubscriptionMutation,
  releaseSubscriptionMutationClaim,
} from './subscription-mutation-claim';

export type SubscriptionProviderMutationOutcome<Value> =
  | { readonly kind: 'applied'; readonly value: Value }
  | { readonly kind: 'not_applied'; readonly error: Error };

interface ExecuteSubscriptionMutationInput<Value, Result> {
  readonly storage: StorageDriver;
  readonly tenantId: string | null;
  readonly subscriptionId: string;
  readonly operation: SubscriptionMutationOperation;
  readonly context: OperationContext;
  readonly intent?: SubscriptionMutationIntentBlob | null;
  readonly claimedAt: Date;
  readonly callProvider: () => Promise<SubscriptionProviderMutationOutcome<Value>>;
  readonly persist: (repositories: Repositories, value: Value) => Promise<Result>;
}

export async function executeSubscriptionMutation<Value, Result>(
  input: ExecuteSubscriptionMutationInput<Value, Result>,
): Promise<Result> {
  const ownerToken = globalThis.crypto.randomUUID();
  const claimReference = `subscription-mutation:${globalThis.crypto.randomUUID()}`;
  await input.storage.transaction((repositories) =>
    acquireSubscriptionMutationClaim(repositories, {
      claimReference,
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId,
      ownerToken,
      operation: input.operation,
      correlationId: input.context.correlationId,
      intent: input.intent ?? null,
      claimedAt: input.claimedAt,
    }),
  );
  let outcome: SubscriptionProviderMutationOutcome<Value>;
  try {
    outcome = await input.callProvider();
  } catch {
    throw ambiguousSubscriptionMutation(claimReference, input.context.correlationId);
  }
  if (outcome.kind === 'not_applied') {
    await input.storage.transaction((repositories) =>
      releaseSubscriptionMutationClaim(repositories, {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        ownerToken,
      }),
    );
    throw outcome.error;
  }
  try {
    return await input.storage.transaction(async (repositories) => {
      const result = await input.persist(repositories, outcome.value);
      await releaseSubscriptionMutationClaim(repositories, {
        tenantId: input.tenantId,
        subscriptionId: input.subscriptionId,
        ownerToken,
      });
      return result;
    });
  } catch {
    throw ambiguousSubscriptionMutation(claimReference, input.context.correlationId);
  }
}
