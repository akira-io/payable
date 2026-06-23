import { describe, expect, it } from 'vitest';
import { buildPaddleClientOptions } from '../src/infrastructure/providers/paddle/paddle-client-options';

describe('buildPaddleClientOptions', () => {
  it('omits headers when no idempotency key is provided', () => {
    expect(buildPaddleClientOptions()).toEqual({});
  });

  it('sets the Idempotency-Key header from the operation key', () => {
    expect(buildPaddleClientOptions('idem-123')).toEqual({
      customHeaders: { 'Idempotency-Key': 'idem-123' },
    });
  });
});
