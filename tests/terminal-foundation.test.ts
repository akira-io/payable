import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import * as PayableApi from '../src/index';
import type { PayableConfig } from '../src/support/config/payable-config';
import { FakeProvider } from './support/fake-provider';

const terminalProvider = {
  name: 'example-terminal',
  capabilities: () => new Set(['devices']),
};

type TerminalProviderAccessor = {
  terminalProviders(): {
    get(name: string): typeof terminalProvider;
    names(): string[];
  };
};

describe('terminal provider foundation', () => {
  it('registers terminal providers independently', () => {
    const config = {
      providers: { payments: new FakeProvider() },
      terminalProviders: { terminal: terminalProvider },
    } as PayableConfig;
    const payable = createPayable(config) as ReturnType<typeof createPayable> &
      TerminalProviderAccessor;

    expect(payable.terminalProviders).toBeTypeOf('function');
    expect(payable.terminalProviders().get('terminal')).toBe(terminalProvider);
    expect(payable.terminalProviders().names()).toEqual(['terminal']);
  });

  it('allows configurations without terminal providers', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      TerminalProviderAccessor;

    expect(payable.terminalProviders).toBeTypeOf('function');
    expect(payable.terminalProviders().names()).toEqual([]);
  });

  it('throws a terminal-specific missing provider error', () => {
    const payable = createPayable({ providers: { payments: new FakeProvider() } }) as ReturnType<
      typeof createPayable
    > &
      TerminalProviderAccessor;
    const MissingProviderError = Reflect.get(PayableApi, 'TerminalProviderNotFoundError') as new (
      ...args: unknown[]
    ) => Error;

    expect(MissingProviderError).toBeTypeOf('function');
    expect(() => payable.terminalProviders().get('missing')).toThrow(MissingProviderError);
  });

  it.each([
    ['isTerminalDeviceCapable', ['listTerminalDevices', 'retrieveTerminalDevice']],
    [
      'isTerminalPaymentCapable',
      ['createTerminalPayment', 'retrieveTerminalPayment', 'cancelTerminalPayment'],
    ],
  ])('requires every method for %s', (exportName, methods) => {
    const guard = Reflect.get(PayableApi, exportName) as (provider: object) => boolean;
    const complete = Object.fromEntries(methods.map((method) => [method, async () => undefined]));
    const partial = Object.fromEntries(
      methods.slice(0, -1).map((method) => [method, async () => undefined]),
    );

    expect(guard).toBeTypeOf('function');
    expect(guard({ ...terminalProvider, ...partial })).toBe(false);
    expect(guard({ ...terminalProvider, ...complete })).toBe(true);
  });
});
