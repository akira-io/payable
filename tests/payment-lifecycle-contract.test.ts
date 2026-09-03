import { describe, expect, it } from 'vitest';
import {
  isAuthorizeCapable,
  isCaptureCapable,
  isVoidCapable,
} from '../src/domain/contracts/payment-lifecycle-provider.contract';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';

function provider(methods: Record<string, unknown> = {}): PaymentProvider {
  return {
    name: 'test',
    capabilities: () => new Set(),
    createCheckoutSession: async () => ({ id: 'checkout', url: 'https://example.test' }),
    refund: async () => {
      throw new Error('unused');
    },
    ...methods,
  };
}

describe('payment lifecycle capabilities', () => {
  it('detects each capability independently', () => {
    expect(isAuthorizeCapable(provider({ authorize: async () => undefined }))).toBe(true);
    expect(isCaptureCapable(provider({ capture: async () => undefined }))).toBe(true);
    expect(isVoidCapable(provider({ void: async () => undefined }))).toBe(true);
  });

  it('does not infer lifecycle support from the base provider', () => {
    const base = provider();
    expect(isAuthorizeCapable(base)).toBe(false);
    expect(isCaptureCapable(base)).toBe(false);
    expect(isVoidCapable(base)).toBe(false);
  });
});
