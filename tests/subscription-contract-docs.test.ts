import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const subscriptionsDocumentation = readFileSync('docs/features/10-subscriptions.md', 'utf8');

describe('subscription contract documentation', () => {
  it('defines portable and provider identities', () => {
    expect(subscriptionsDocumentation).toContain('provider-neutral customer');
    expect(subscriptionsDocumentation).toContain('local subscription ID');
    expect(subscriptionsDocumentation).toContain('provider subscription-item ID');
    expect(subscriptionsDocumentation).toContain('SUBSCRIPTION_NOT_FOUND');
  });

  it('keeps historical prices until an explicit migration succeeds', () => {
    expect(subscriptionsDocumentation).toContain('historical price');
    expect(subscriptionsDocumentation).toContain('explicit successful migration');
    expect(subscriptionsDocumentation).toContain('SUBSCRIPTION_CHANGE_PREVIEW_STALE');
  });

  it('documents compatibility and migration failures', () => {
    expect(subscriptionsDocumentation).toContain('subscriptionOperationCapabilities');
    expect(subscriptionsDocumentation).toContain('provider item ID is null');
    expect(subscriptionsDocumentation).toContain('SUBSCRIPTION_CHANGE_POLICY_REQUIRED');
  });
});
