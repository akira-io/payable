import { describe, expect, it } from 'vitest';
import { buildPaddleClientOptions } from '../src/infrastructure/providers/paddle/paddle-client-options';

describe('buildPaddleClientOptions', () => {
  it('defaults to the production environment and no headers', () => {
    expect(buildPaddleClientOptions()).toEqual({
      environment: 'production',
      customHeaders: undefined,
    });
  });

  it('honours the sandbox environment', () => {
    expect(buildPaddleClientOptions('sandbox').environment).toBe('sandbox');
  });

  it('sets the Idempotency-Key header from the operation key', () => {
    expect(buildPaddleClientOptions('production', 'idem-123').customHeaders).toEqual({
      'Idempotency-Key': 'idem-123',
    });
  });
});
