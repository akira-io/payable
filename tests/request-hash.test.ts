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
});
