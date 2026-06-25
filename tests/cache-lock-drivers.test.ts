import { describe, expect, it } from 'vitest';
import { MemoryCacheDriver } from '../src/infrastructure/cache/memory/memory-cache-driver';
import { RedisCacheDriver } from '../src/infrastructure/cache/redis/redis-cache-driver';
import { MemoryLockDriver } from '../src/infrastructure/locks/memory-lock-driver';
import { RedisLockDriver } from '../src/infrastructure/locks/redis-lock-driver';

describe('MemoryCacheDriver', () => {
  it('stores, reads, and deletes values', async () => {
    const cache = new MemoryCacheDriver();
    await cache.set('k', { a: 1 });
    expect(await cache.has('k')).toBe(true);
    expect(await cache.get<{ a: number }>('k')).toEqual({ a: 1 });
    await cache.delete('k');
    expect(await cache.get('k')).toBeNull();
    expect(await cache.has('k')).toBe(false);
  });

  it('expires entries after their ttl', async () => {
    let now = 1000;
    const cache = new MemoryCacheDriver(() => now);
    await cache.set('k', 'v', 5);
    expect(await cache.get('k')).toBe('v');
    now += 5000;
    expect(await cache.get('k')).toBeNull();
    expect(await cache.has('k')).toBe(false);
  });
});

describe('MemoryLockDriver', () => {
  it('grants a single holder until released', async () => {
    const now = 0;
    const locks = new MemoryLockDriver(() => now);
    const first = await locks.acquire('key', 1000);
    expect(first).not.toBeNull();
    expect(await locks.acquire('key', 1000)).toBeNull();
    await first?.release();
    expect(await locks.acquire('key', 1000)).not.toBeNull();
  });

  it('reacquires after the ttl elapses', async () => {
    let now = 0;
    const locks = new MemoryLockDriver(() => now);
    await locks.acquire('key', 1000);
    now = 1001;
    expect(await locks.acquire('key', 1000)).not.toBeNull();
  });

  it('runs work under a lock and releases it', async () => {
    const locks = new MemoryLockDriver();
    const result = await locks.withLock('key', 1000, async () => 'done');
    expect(result).toBe('done');
    expect(await locks.acquire('key', 1000)).not.toBeNull();
  });

  it('does not release a lock a later holder owns after the ttl lapsed', async () => {
    let now = 0;
    const locks = new MemoryLockDriver(() => now);
    const first = await locks.acquire('key', 1000);
    expect(first).not.toBeNull();

    now = 1001;
    const second = await locks.acquire('key', 1000);
    expect(second).not.toBeNull();

    await first?.release();
    expect(await locks.acquire('key', 1000)).toBeNull();

    await second?.release();
    expect(await locks.acquire('key', 1000)).not.toBeNull();
  });
});

describe('Redis drivers fail fast', () => {
  it('throw at construction instead of deferring to first use', () => {
    expect(() => new RedisCacheDriver({})).toThrow(/NOT_IMPLEMENTED|Phase 7/);
    expect(() => new RedisLockDriver({})).toThrow(/NOT_IMPLEMENTED|Phase 7/);
  });
});
