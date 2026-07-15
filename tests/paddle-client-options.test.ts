import { describe, expect, it } from 'vitest';
import { buildPaddleClientOptions } from '../src/infrastructure/providers/paddle/paddle-client-options';

describe('buildPaddleClientOptions', () => {
  it('defaults to the production environment', () => {
    expect(buildPaddleClientOptions()).toEqual({ environment: 'production' });
  });

  it('honours the sandbox environment', () => {
    expect(buildPaddleClientOptions('sandbox').environment).toBe('sandbox');
  });

  it('never fabricates an Idempotency-Key header', () => {
    expect(Object.keys(buildPaddleClientOptions('production'))).toEqual(['environment']);
  });
});
