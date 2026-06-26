import { describe, expect, it } from 'vitest';
import { billableObject } from '../src/presentation/mcp/schemas';

describe('mcp billableObject', () => {
  it('accepts a valid email', () => {
    const parsed = billableObject.parse({
      billableType: 'User',
      billableId: '1',
      email: 'user@example.com',
    });
    expect(parsed.email).toBe('user@example.com');
  });

  it('rejects a malformed email instead of any non-empty string', () => {
    expect(() =>
      billableObject.parse({ billableType: 'User', billableId: '1', email: 'not-an-email' }),
    ).toThrow();
  });
});
