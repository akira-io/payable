import { describe, expect, it } from 'vitest';
import { toJson } from '../src/infrastructure/storage/knex/mappers';

describe('toJson', () => {
  it('parses a valid JSON string', () => {
    expect(toJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns null for null or undefined', () => {
    expect(toJson(null)).toBeNull();
    expect(toJson(undefined)).toBeNull();
  });

  it('passes through an already-parsed object', () => {
    const value = { a: 1 };
    expect(toJson(value)).toBe(value);
  });

  it('returns null instead of throwing on malformed JSON', () => {
    expect(toJson('{not json')).toBeNull();
  });
});
