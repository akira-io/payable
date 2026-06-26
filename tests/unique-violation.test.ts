import { describe, expect, it } from 'vitest';
import { isUniqueViolation } from '../src/infrastructure/storage/knex/unique-violation';

describe('isUniqueViolation', () => {
  it('detects the Postgres, SQLite, and MySQL duplicate-key shapes', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'SQLITE_CONSTRAINT_UNIQUE' })).toBe(true);
    expect(isUniqueViolation({ code: 'ER_DUP_ENTRY' })).toBe(true);
    expect(isUniqueViolation({ errno: 1062 })).toBe(true);
    expect(isUniqueViolation({ message: 'UNIQUE constraint failed: t.col' })).toBe(true);
  });

  it('does not classify unrelated errors as duplicates', () => {
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(isUniqueViolation({ message: 'connection refused' })).toBe(false);
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
  });
});
