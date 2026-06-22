import { describe, expect, it } from 'vitest';
import { FakeClock } from '../src/support/clock/fake-clock';
import { SystemClock } from '../src/support/clock/system-clock';

describe('FakeClock', () => {
  it('returns the configured instant', () => {
    const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2026-06-22T00:00:00.000Z');
  });

  it('advances and resets deterministically', () => {
    const clock = new FakeClock(new Date('2026-01-01T00:00:00.000Z'));
    clock.advance(1000);
    expect(clock.now().toISOString()).toBe('2026-01-01T00:00:01.000Z');
    clock.set(new Date('2030-01-01T00:00:00.000Z'));
    expect(clock.now().toISOString()).toBe('2030-01-01T00:00:00.000Z');
  });
});

describe('SystemClock', () => {
  it('produces a Date', () => {
    expect(new SystemClock().now()).toBeInstanceOf(Date);
  });
});
