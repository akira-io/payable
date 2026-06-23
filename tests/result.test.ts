import { describe, expect, it } from 'vitest';
import { err, isErr, isOk, ok, unwrap } from '../src/support/result/result';

describe('Result', () => {
  it('wraps success values', () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(unwrap(result)).toBe(42);
  });

  it('wraps errors', () => {
    const result = err(new Error('nope'));
    expect(isErr(result)).toBe(true);
    expect(() => unwrap(result)).toThrow('nope');
  });

  it('preserves a non-Error value as the thrown error cause', () => {
    const original = { code: 'CUSTOM', detail: 'x' };
    try {
      unwrap(err(original));
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).cause).toBe(original);
    }
  });
});
