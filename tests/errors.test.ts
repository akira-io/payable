import { describe, expect, it } from 'vitest';
import { CustomerNotFoundError } from '../src/domain/errors/customer-not-found.error';
import { PayableError } from '../src/domain/errors/payable-error';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
import { ProviderNotFoundError } from '../src/domain/errors/provider-not-found.error';

describe('PayableError', () => {
  it('carries a code and context', () => {
    const error = new PayableError('boom', { code: 'X', context: { a: 1 } });
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('X');
    expect(error.context).toEqual({ a: 1 });
  });

  it('builds a not-implemented error', () => {
    const error = PayableError.notImplemented('Foo.bar');
    expect(error.code).toBe('NOT_IMPLEMENTED');
    expect(error.message).toContain('Foo.bar');
  });

  it('serializes message and code via toJSON without leaking the cause', () => {
    const cause = new Error('provider secret abc123');
    const error = new PayableError('boom', { code: 'X', context: { a: 1 }, cause });
    const json = JSON.parse(JSON.stringify(error));
    expect(json).toEqual({ name: 'PayableError', code: 'X', message: 'boom', context: { a: 1 } });
    expect(JSON.stringify(error)).not.toContain('abc123');
  });

  it('redacts sensitive context keys in toJSON', () => {
    const error = new PayableError('boom', {
      code: 'X',
      context: { apiKey: 'sk_live_1', cardNumber: '4242', paymentId: 'pay_1' },
    });
    const json = error.toJSON();
    expect(json.context).toEqual({
      apiKey: '[redacted]',
      cardNumber: '[redacted]',
      paymentId: 'pay_1',
    });
  });

  it('captures a stack trace at the throw site', () => {
    const error = new PayableError('boom');
    expect(error.stack).toBeDefined();
  });

  it('subclasses keep their name and code', () => {
    const error = new ProviderNotFoundError('stripe');
    expect(error).toBeInstanceOf(PayableError);
    expect(error.name).toBe('ProviderNotFoundError');
    expect(error.code).toBe('PROVIDER_NOT_FOUND');
    expect(error.context).toEqual({ provider: 'stripe' });
  });

  it('captures structured context for capability errors', () => {
    const error = new ProviderCapabilityNotSupportedError('paddle', 'meteredBilling');
    expect(error.code).toBe('PROVIDER_CAPABILITY_NOT_SUPPORTED');
    expect(error.context).toEqual({ provider: 'paddle', capability: 'meteredBilling' });
  });

  it('formats not-found messages', () => {
    expect(new CustomerNotFoundError('cus_1').message).toContain('cus_1');
  });
});
