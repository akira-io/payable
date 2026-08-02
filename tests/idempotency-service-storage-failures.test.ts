import { describe, expect, it, vi } from 'vitest';
import { IdempotencyService } from '../src/application/services/idempotency/idempotency-service';
import { FakeClock } from '../src/support/clock/fake-clock';
import { InMemoryIdempotencyStore } from './support/fakes';

const execution = (run: () => Promise<string>) => ({
  key: 'storage-failure',
  scope: 'charge',
  operation: 'charge',
  request: { amount: 9900, currency: 'USD' },
  run,
});

describe('IdempotencyService storage failures', () => {
  it('fails closed when the initial record lookup rejects', async () => {
    const store = new InMemoryIdempotencyStore();
    const storageFailure = new Error('initial lookup unavailable');
    vi.spyOn(store, 'find').mockRejectedValue(storageFailure);
    const run = vi.fn(async () => 'charged');

    await expect(
      new IdempotencyService(store, new FakeClock()).execute(execution(run)),
    ).rejects.toBe(storageFailure);

    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed when record acquisition rejects', async () => {
    const store = new InMemoryIdempotencyStore();
    const storageFailure = new Error('acquisition unavailable');
    vi.spyOn(store, 'acquire').mockRejectedValue(storageFailure);
    const run = vi.fn(async () => 'charged');

    await expect(
      new IdempotencyService(store, new FakeClock()).execute(execution(run)),
    ).rejects.toBe(storageFailure);

    expect(run).not.toHaveBeenCalled();
  });

  it('fails closed when the read after a lost acquisition race rejects', async () => {
    const store = new InMemoryIdempotencyStore();
    const storageFailure = new Error('winner lookup unavailable');
    vi.spyOn(store, 'find').mockResolvedValueOnce(null).mockRejectedValueOnce(storageFailure);
    vi.spyOn(store, 'acquire').mockResolvedValue(false);
    const run = vi.fn(async () => 'charged');

    await expect(
      new IdempotencyService(store, new FakeClock()).execute(execution(run)),
    ).rejects.toBe(storageFailure);

    expect(run).not.toHaveBeenCalled();
  });
});
