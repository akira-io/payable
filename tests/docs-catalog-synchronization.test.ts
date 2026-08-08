import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('catalog synchronization documentation', () => {
  it('documents explicit synchronization and adapter capability scope', () => {
    const lifecycle = readFileSync('docs/examples/45-catalog-lifecycle.md', 'utf8');
    const providers = readFileSync('docs/integrations/17-providers.md', 'utf8');

    expect(lifecycle).toContain("catalogSync('stripe-primary', 'tenant-acme')");
    expect(lifecycle).toContain('retryProduct');
    expect(lifecycle).toContain('reconcilePrice');
    expect(providers).toContain('support implemented by each built-in Payable adapter');
    expect(providers).toContain('| `catalogProductCreate` | yes | yes | no | no |');
    expect(providers).toContain('https://docs.stripe.com/api/idempotent_requests');
    expect(providers).toContain('https://developer.paddle.com/webhooks/overview');
  });
});
