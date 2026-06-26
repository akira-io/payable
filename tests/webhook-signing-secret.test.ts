import { describe, expect, it } from 'vitest';
import { WebhookSigningSecret } from '../src/domain/value-objects/webhook-signing-secret';

describe('WebhookSigningSecret', () => {
  it('treats equal secrets as equal and different secrets as unequal', () => {
    const a = WebhookSigningSecret.from(`whsec_${'a'.repeat(64)}`);
    const b = WebhookSigningSecret.from(`whsec_${'a'.repeat(64)}`);
    const c = WebhookSigningSecret.from(`whsec_${'b'.repeat(64)}`);
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('treats secrets of different lengths as unequal', () => {
    const a = WebhookSigningSecret.from(`whsec_${'a'.repeat(64)}`);
    const b = WebhookSigningSecret.from(`whsec_${'a'.repeat(32)}`);
    expect(a.equals(b)).toBe(false);
  });

  it('rejects a secret without the expected prefix', () => {
    expect(() => WebhookSigningSecret.from('nope')).toThrow(/whsec_/);
  });

  it('generates a prefixed secret', () => {
    expect(WebhookSigningSecret.generate().toString()).toMatch(/^whsec_[0-9a-f]{64}$/);
  });
});
