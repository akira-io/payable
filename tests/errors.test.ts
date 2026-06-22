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
