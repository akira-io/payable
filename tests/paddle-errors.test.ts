import { describe, expect, it } from 'vitest';
import { PayableError } from '../src/domain/errors/payable-error';
import { ProductNotFoundError } from '../src/domain/errors/product-not-found.error';
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

  it('maps Paddle errors that carry only a code or only a detail', async () => {
    await expect(
      withPaddleErrors(() => Promise.reject({ code: 'rate_limit_exceeded' })),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
    await expect(
      withPaddleErrors(() => Promise.reject({ detail: 'gateway exploded' })),
    ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
  });

  it('passes through a PayableError and a non-Paddle error unchanged', async () => {
    const payable = new PayableError('boom', { code: 'CUSTOM' });
    await expect(withPaddleErrors(() => Promise.reject(payable))).rejects.toBe(payable);
    const plain = new Error('network down');
    await expect(withPaddleErrors(() => Promise.reject(plain))).rejects.toBe(plain);
  });

  it('maps Paddle not_found errors only when an operation supplies a contextual code', async () => {
    const missing = () => Promise.reject({ code: 'not_found', detail: 'missing' });

    await expect(
      withPaddleErrors(missing, (options) => new ProductNotFoundError('pro_missing', options)),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });
    await expect(withPaddleErrors(missing)).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_INVALID',
    });
  });
});
