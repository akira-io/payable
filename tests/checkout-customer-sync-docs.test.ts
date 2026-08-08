import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('checkout customer synchronization documentation', () => {
  it('describes redirect checkout customer synchronization as capability-dependent', () => {
    const documentation = readFileSync('docs/features/09-checkout.md', 'utf8');

    expect(documentation).not.toContain('it does not call the provider customer sync');
    expect(documentation).toContain('`customers` capability');
  });
});
