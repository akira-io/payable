import { describe, expect, it } from 'vitest';
import { DependencyFactory } from '../src/application/builders/dependency-factory';
import { createPayable } from '../src/create-payable';
import type { Logger } from '../src/domain/contracts/logger.contract';
import { ProviderRegistry } from '../src/provider-registry';
import { resolveConfig } from '../src/support/config/payable-config';
import { TreasuryProviderRegistry } from '../src/treasury-provider-registry';
import { FakeProvider } from './support/fake-provider';
import { InMemoryIdempotencyStore } from './support/fakes';

function recordingLogger() {
  const warnings: string[] = [];
  const logger: Logger = {
    debug() {},
    info() {},
    warn: (message) => warnings.push(message),
    error() {},
  };
  return { logger, warnings };
}

describe('idempotency configuration warning', () => {
  it('warns when idempotency is enabled but no store is configured', () => {
    const { logger, warnings } = recordingLogger();
    createPayable({ providers: { stripe: new FakeProvider() }, logger });
    expect(warnings.some((message) => message.includes('no idempotency store'))).toBe(true);
  });

  it('does not warn when idempotency strategy is manual', () => {
    const { logger, warnings } = recordingLogger();
    createPayable({
      providers: { stripe: new FakeProvider() },
      logger,
      idempotency: { strategy: 'manual' },
    });
    expect(warnings).toHaveLength(0);
  });

  it('does not warn when idempotency is disabled', () => {
    const { logger, warnings } = recordingLogger();
    createPayable({
      providers: { stripe: new FakeProvider() },
      logger,
      idempotency: { enabled: false },
    });
    expect(warnings).toHaveLength(0);
  });

  it('wires catalog idempotency in manual mode without changing general idempotency', () => {
    const provider = new FakeProvider();
    const resolved = resolveConfig({
      providers: { stripe: provider },
      idempotency: { strategy: 'manual', store: new InMemoryIdempotencyStore() },
    });
    const factory = new DependencyFactory(
      resolved,
      new ProviderRegistry(resolved.providers),
      new TreasuryProviderRegistry(resolved.treasuryProviders),
    );

    const dependencies = factory.billing('stripe');

    expect(dependencies.idempotency).toBeUndefined();
    expect(dependencies.catalogIdempotency).toBeDefined();
  });

  it('shares one configured service for automatic and catalog idempotency', () => {
    const provider = new FakeProvider();
    const resolved = resolveConfig({
      providers: { stripe: provider },
      idempotency: { store: new InMemoryIdempotencyStore() },
    });
    const factory = new DependencyFactory(
      resolved,
      new ProviderRegistry(resolved.providers),
      new TreasuryProviderRegistry(resolved.treasuryProviders),
    );

    const dependencies = factory.billing('stripe');

    expect(dependencies.idempotency).toBeDefined();
    expect(dependencies.catalogIdempotency).toBe(dependencies.idempotency);
  });
});
