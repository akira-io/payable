import { describe, expect, it } from 'vitest';
import type {
  ResolveSubscriptionMutationClaimInput,
  SubscriptionMutationClaimRepository,
  SubscriptionMutationClaimResource,
  SubscriptionMutationClaimView,
  SubscriptionMutationIntentBlob,
} from '../src/index';
import * as payable from '../src/index';

describe('subscription mutation claim public API', () => {
  it('exports only provider-neutral claim contracts', () => {
    const input = {
      idempotencyKey: 'claim-resolution-1',
      outcome: 'unknown',
      evidenceReference: 'operator-case-2',
    } satisfies ResolveSubscriptionMutationClaimInput;
    const view = {
      claimReference: 'claim-1',
      tenantId: null,
      subscriptionId: 'subscription-1',
      operation: 'subscription_swap',
      correlationId: 'correlation-1',
      status: 'active',
      resolutionOutcome: null,
      resolutionEvidenceReference: null,
      resolvedAt: null,
      observationOutcome: 'unknown',
      observationEvidenceReference: 'operator-case-2',
      observedAt: new Date(0),
      claimedAt: new Date(0),
    } satisfies SubscriptionMutationClaimView;
    const resource = {} as SubscriptionMutationClaimResource;
    const repository = {} as SubscriptionMutationClaimRepository;
    const intent: SubscriptionMutationIntentBlob = payable.rehydrateSubscriptionMutationIntentBlob(
      'payable:subscription-mutation-intent:v1:opaque',
    );

    expect(input.outcome).toBe('unknown');
    expect(view.status).toBe('active');
    expect(typeof resource).toBe('object');
    expect(typeof repository).toBe('object');
    expect(intent).toContain('opaque');
    expect(typeof (payable as Record<string, unknown>).SubscriptionMutationClaimResource).toBe(
      'undefined',
    );
    expect((payable as Record<string, unknown>).encodeSubscriptionMutationIntent).toBeUndefined();
    expect((payable as Record<string, unknown>).decodeSubscriptionMutationIntent).toBeUndefined();
  });
});
