import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const identityProvider = {
  name: 'example-identity',
  capabilities: () => new Set(['verificationSessions']),
};

type IdentityProviderAccessor = {
  identityProviders(): {
    get(name: string): typeof identityProvider;
    names(): string[];
  };
};

describe('identity provider foundation', () => {
  it('registers identity providers independently', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      identityProviders: { identity: identityProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> &
      IdentityProviderAccessor;

    expect(payable.identityProviders).toBeTypeOf('function');
    expect(payable.identityProviders().get('identity')).toBe(identityProvider);
    expect(payable.identityProviders().names()).toEqual(['identity']);
  });

  it('allows configurations without identity providers', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      IdentityProviderAccessor;

    expect(payable.identityProviders).toBeTypeOf('function');
    expect(payable.identityProviders().names()).toEqual([]);
  });

  it('throws an identity-specific missing provider error', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      IdentityProviderAccessor;
    const MissingProviderError = Reflect.get(PayableApi, 'IdentityProviderNotFoundError') as new (
      ...args: unknown[]
    ) => Error;

    expect(MissingProviderError).toBeTypeOf('function');
    expect(() => payable.identityProviders().get('missing')).toThrow(MissingProviderError);
  });

  it('requires every identity verification lifecycle method', () => {
    const guard = Reflect.get(PayableApi, 'isIdentityVerificationCapable') as (
      provider: object,
    ) => boolean;
    const methods = [
      'createIdentityVerification',
      'retrieveIdentityVerification',
      'cancelIdentityVerification',
      'redactIdentityVerification',
    ];
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...identityProvider, ...partial })).toBe(false);
    expect(guard({ ...identityProvider, ...complete })).toBe(true);
  });
});
