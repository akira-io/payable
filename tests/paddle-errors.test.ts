import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { withPaddleErrors } from '../src/infrastructure/providers/paddle/paddle-errors';

describe('withPaddleErrors', () => {
  it('maps known codes and falls back to PROVIDER_ERROR', async () => {
    await expect(
      withPaddleErrors(() => Promise.reject({ code: 'rate_limit_exceeded', detail: 'slow down' })),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    await expect(
      withPaddleErrors(() => Promise.reject({ code: 'something_else', detail: 'x' })),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('passes through a PayableError and a non-Paddle error unchanged', async () => {
    const payable = new PayableError('boom', { code: 'CUSTOM' });
    await expect(withPaddleErrors(() => Promise.reject(payable))).rejects.toBe(payable);
    const plain = new Error('network down');
    await expect(withPaddleErrors(() => Promise.reject(plain))).rejects.toBe(plain);
  });
});
