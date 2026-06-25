import { describe, expect, it } from 'vitest';
import { toDate, toJson, toNullableDate } from '../src/infrastructure/storage/knex/mappers';

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

describe('toDate', () => {
  it('parses a timestamp value', () => {
    expect(toDate('2026-01-01T00:00:00.000Z').toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('throws on null or undefined instead of silently producing the epoch', () => {
    expect(() => toDate(null)).toThrow(TypeError);
    expect(() => toDate(undefined)).toThrow(TypeError);
  });

  it('leaves nullable columns to toNullableDate', () => {
    expect(toNullableDate(null)).toBeNull();
  });
});
