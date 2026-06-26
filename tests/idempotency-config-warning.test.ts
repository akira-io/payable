import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { Logger } from '../src/domain/contracts/logger.contract';
import { FakeProvider } from './support/fake-provider';

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
});
