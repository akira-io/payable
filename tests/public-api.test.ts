import { describe, expect, it } from 'vitest';
import type {
  AuthorizationConfig,
  AuthorizationContext,
  CreatePaymentMethodSetupInput,
  PaymentMethodSetupCapable,
  PaymentMethodSetupDTO,
  TreasuryWebhookCapable,
  TreasuryWebhookEventType,
  VerifiedTreasuryWebhook,
} from '../src/index';
import * as payable from '../src/index';

describe('public API surface', () => {
  it('exports the core entry points explicitly', () => {
    expect(typeof payable.createPayable).toBe('function');
    expect(typeof payable.Payable).toBe('function');
    expect(typeof payable.Money).toBe('function');
    expect(typeof payable.IdempotencyKey).toBe('function');
    expect(typeof payable.StripeProvider).toBe('function');
    expect(typeof payable.PaddleProvider).toBe('function');
    expect(typeof payable.RevolutProvider).toBe('function');
    expect(typeof payable.KnexStorageDriver).toBe('function');
    expect(typeof payable.ok).toBe('function');
    expect(typeof payable.isChargeCapable).toBe('function');
    expect(typeof payable.isDisputeCapable).toBe('function');
    expect(typeof payable.isPaymentMethodCapable).toBe('function');
    expect(typeof payable.isPaymentMethodSetupCapable).toBe('function');
    expect(typeof payable.isPayoutCapable).toBe('function');
    expect(typeof payable.isProviderWebhookEndpointManagementCapable).toBe('function');
    expect(typeof payable.isPaymentWebhookCapable).toBe('function');
    expect(typeof payable.isTreasuryWebhookCapable).toBe('function');
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

  it('exports the payment method setup contract types', () => {
    const input: CreatePaymentMethodSetupInput = {
      providerCustomerId: 'customer_1',
      usage: 'off_session',
    };
    const setup: PaymentMethodSetupDTO = {
      providerSetupId: 'setup_1',
      providerCustomerId: input.providerCustomerId,
      status: 'requires_action',
      usage: input.usage,
      clientSecret: null,
      checkoutUrl: null,
      providerPaymentMethodId: null,
      createdAt: null,
    };
    const capable = {} as PaymentMethodSetupCapable;

    expect(setup.providerCustomerId).toBe('customer_1');
    expect(typeof capable).toBe('object');
  });

  it('exports the Treasury webhook contract types', () => {
    const normalizedType: TreasuryWebhookEventType = 'treasury.transaction.updated';
    const webhook: VerifiedTreasuryWebhook = {
      providerEventId: 'event_1',
      type: 'TransactionStateChanged',
      normalizedType,
      occurredAt: null,
      data: {},
    };
    const capable = {} as TreasuryWebhookCapable;

    expect(webhook.normalizedType).toBe(normalizedType);
    expect(typeof capable).toBe('object');
  });

  it('does not export the not-yet-implemented Redis drivers', () => {
    expect('RedisCacheDriver' in payable).toBe(false);
    expect('RedisLockDriver' in payable).toBe(false);
    expect(typeof payable.MemoryCacheDriver).toBe('function');
    expect(typeof payable.MemoryLockDriver).toBe('function');
  });

  it('exports the redaction helpers for custom adapters and loggers', () => {
    expect(typeof payable.redactHeaders).toBe('function');
    expect(typeof payable.redactContext).toBe('function');
    expect(payable.redactHeaders({ authorization: 'secret' }).authorization).toBeUndefined();
  });
});
