import { describe, expect, it } from 'vitest';
import type { AuthorizationConfig, AuthorizationContext } from '../src/index';
import * as payable from '../src/index';

describe('public API surface', () => {
  it('exports the core entry points explicitly', () => {
    expect(typeof payable.createPayable).toBe('function');
    expect(typeof payable.Payable).toBe('function');
    expect(typeof payable.Money).toBe('function');
    expect(typeof payable.IdempotencyKey).toBe('function');
    expect(typeof payable.StripeProvider).toBe('function');
    expect(typeof payable.PaddleProvider).toBe('function');
    expect(typeof payable.KnexStorageDriver).toBe('function');
    expect(typeof payable.ok).toBe('function');
    expect(typeof payable.isChargeCapable).toBe('function');
    expect(typeof payable.SubscriptionStateMachine).toBe('function');
  });

  it('exports AuthorizationContext on the public surface', () => {
    const context: AuthorizationContext = { allowed: true, actorId: 'a', actorType: 'user' };
    expect(context.allowed).toBe(true);
  });

  it('exports AuthorizationConfig alongside the sibling config types', () => {
    const config: AuthorizationConfig = { enabled: true };
    expect(config.enabled).toBe(true);
  });

  it('exports the redaction helpers for custom adapters and loggers', () => {
    expect(typeof payable.redactHeaders).toBe('function');
    expect(typeof payable.redactContext).toBe('function');
    expect(payable.redactHeaders({ authorization: 'secret' }).authorization).toBeUndefined();
  });
});
