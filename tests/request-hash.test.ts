import { describe, expect, it } from 'vitest';
import { hashRequest } from '../src/support/hash/request-hash';

describe('hashRequest', () => {
  it('is stable regardless of key order', async () => {
    const a = await hashRequest({ amount: 1099, currency: 'EUR' });
    const b = await hashRequest({ currency: 'EUR', amount: 1099 });
    expect(a).toBe(b);
  });

  it('orders keys deterministically regardless of locale-sensitive casing', async () => {
    const a = await hashRequest({ Z: 1, a: 2, Aa: 3 });
    const b = await hashRequest({ a: 2, Aa: 3, Z: 1 });
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

  it('rejects non-serializable and non-finite values instead of colliding with null', async () => {
    await expect(hashRequest({ a: () => {} })).rejects.toThrow(/non-serializable/);
    await expect(hashRequest({ a: Symbol('x') })).rejects.toThrow(/non-serializable/);
    await expect(hashRequest({ a: Number.NaN })).rejects.toThrow(/non-finite/);
    await expect(hashRequest({ a: Number.POSITIVE_INFINITY })).rejects.toThrow(/non-finite/);
  });

  it('rejects Map and Set instead of collapsing them to an empty object', async () => {
    await expect(hashRequest({ a: new Map([['k', 1]]) })).rejects.toThrow(/non-serializable Map/);
    await expect(hashRequest({ a: new Set([1, 2]) })).rejects.toThrow(/non-serializable Set/);
  });

  it('rejects deeply nested or cyclic structures instead of overflowing the stack', async () => {
    let head: Record<string, unknown> = {};
    const deep = head;
    for (let index = 0; index < 200; index += 1) {
      const next: Record<string, unknown> = {};
      head.next = next;
      head = next;
    }
    await expect(hashRequest(deep)).rejects.toThrow(/nested deeper/);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(hashRequest(cyclic)).rejects.toThrow(/nested deeper/);
  });
});
