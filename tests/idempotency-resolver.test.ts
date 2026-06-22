import { describe, expect, it } from 'vitest';
import { ExecuteIdempotentOperationAction } from '../src/application/actions/idempotency/execute-idempotent-operation.action';
import { ResolveIdempotencyKeyAction } from '../src/application/actions/idempotency/resolve-idempotency-key.action';
import { DefaultIdempotencyKeyResolver } from '../src/application/services/idempotency/default-idempotency-key-resolver';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import type { IdempotencyKeyResolver } from '../src/domain/contracts/idempotency-key-resolver.contract';
import { FakeClock } from '../src/support/clock/fake-clock';
import { InMemoryIdempotencyStore } from './support/fakes';

const fixed = (value: string | null): IdempotencyKeyResolver => ({ resolve: () => value });
const context = { operation: 'charge', provider: 'stripe', resourceType: 'User', resourceId: '1' };

describe('DefaultIdempotencyKeyResolver', () => {
  it('builds a deterministic key from context', () => {
    expect(new DefaultIdempotencyKeyResolver().resolve(context)).toBe('op:charge:stripe:User:1');
  });

  it('fills missing parts with na', () => {
    expect(new DefaultIdempotencyKeyResolver().resolve({ operation: 'charge' })).toBe(
      'op:charge:na:na:na',
    );
  });
});

describe('ResolveIdempotencyKeyAction', () => {
  const action = new ResolveIdempotencyKeyAction();

  it('prefers an explicit key', () => {
    expect(
      action
        .handle({ context, explicitKey: 'explicit', entityResolver: fixed('entity') })
        .toString(),
    ).toBe('explicit');
  });

  it('falls back through entity, global, then default', () => {
    expect(action.handle({ context, entityResolver: fixed('entity') }).toString()).toBe('entity');
    expect(
      action
        .handle({ context, entityResolver: fixed(null), globalResolver: fixed('global') })
        .toString(),
    ).toBe('global');
    expect(action.handle({ context }).toString()).toBe('op:charge:stripe:User:1');
  });
});

describe('ExecuteIdempotentOperationAction', () => {
  it('resolves the key and deduplicates the operation', async () => {
    const service = new IdempotencyService(new InMemoryIdempotencyStore(), new FakeClock());
    const action = new ExecuteIdempotentOperationAction(service);
    let runs = 0;
    const input = {
      scope: 'charge',
      context,
      request: { amount: 9900 },
      explicitKey: 'charge:k1',
      run: async () => {
        runs += 1;
        return 'ok';
      },
    };

    await action.handle(input);
    await action.handle(input);
    expect(runs).toBe(1);
  });
});
