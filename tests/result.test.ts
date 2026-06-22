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
});
