import { describe, expect, it } from 'vitest';
import { hashRequest } from '../src/support/hash/request-hash';

describe('hashRequest', () => {
  it('is stable regardless of key order', async () => {
    const a = await hashRequest({ amount: 1099, currency: 'EUR' });
    const b = await hashRequest({ currency: 'EUR', amount: 1099 });
    expect(a).toBe(b);
  });

  it('ignores undefined fields', async () => {
    const a = await hashRequest({ amount: 1099, note: undefined });
    const b = await hashRequest({ amount: 1099 });
    expect(a).toBe(b);
  });

  it('differs for different content', async () => {
    const a = await hashRequest({ amount: 1099, currency: 'EUR' });
    const b = await hashRequest({ amount: 1100, currency: 'EUR' });
    expect(a).not.toBe(b);
  });

  it('produces a 64-character hex digest', async () => {
    expect(await hashRequest({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashes BigInt values deterministically without throwing', async () => {
    const a = await hashRequest({ amount: 10n });
    const b = await hashRequest({ amount: 10n });
    const c = await hashRequest({ amount: 11n });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('canonicalizes arrays with undefined and null elements stably', async () => {
    const a = await hashRequest({ items: [1, undefined, null] });
    const b = await hashRequest({ items: [1, undefined, null] });
    expect(a).toBe(b);
  });

  it('distinguishes Date values instead of collapsing them to an empty object', async () => {
    const a = await hashRequest({ at: new Date('2026-01-01T00:00:00.000Z') });
    const b = await hashRequest({ at: new Date('2026-02-01T00:00:00.000Z') });
    const empty = await hashRequest({ at: {} });
    expect(a).not.toBe(b);
    expect(a).not.toBe(empty);
  });

  it('hashes objects via toJSON (value objects) by their serialized value', async () => {
    const money = { amount: () => 1000, toJSON: () => ({ amount: 1000, currency: 'USD' }) };
    const a = await hashRequest({ price: money });
    const b = await hashRequest({ price: { amount: 1000, currency: 'USD' } });
    expect(a).toBe(b);
  });
});
