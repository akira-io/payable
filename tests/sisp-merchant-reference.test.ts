import { describe, expect, it } from 'vitest';
import { sispMerchantReference } from '../src/infrastructure/providers/sisp/sisp-merchant-reference';

describe('sispMerchantReference', () => {
  it('is deterministic for a given idempotency key', () => {
    expect(sispMerchantReference('idem-1')).toBe(sispMerchantReference('idem-1'));
  });

  it('differs across keys and matches the SISP reference shape', () => {
    expect(sispMerchantReference('idem-1')).not.toBe(sispMerchantReference('idem-2'));
    expect(sispMerchantReference('idem-1')).toMatch(/^R[0-9A-F]{14}$/);
  });
});
