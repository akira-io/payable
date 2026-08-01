import { describe, expect, it, vi } from 'vitest';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';

describe('PaddleProvider basics', () => {
  it('reports Paddle capabilities', () => {
    const capabilities = new PaddleProvider({
      apiKey: 'pdl_test',
      webhookSecret: 'wh_test',
    }).capabilities();

    expect(capabilities.has('checkout')).toBe(true);
    expect(capabilities.has('invoicePdf')).toBe(false);
    expect(capabilities.has('trials')).toBe(false);
    expect(capabilities.has('coupons')).toBe(false);
  });

  it('creates a customer', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'ctm_1',
      email: 'user@example.com',
      name: 'User',
    });
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      customers: { create },
    } as unknown as PaddleClient);

    await expect(
      paddle.createCustomer(
        { email: 'user@example.com', name: 'User', billableType: 'User', billableId: '1' },
        { correlationId: 'corr-1', idempotencyKey: 'idem-1' },
      ),
    ).resolves.toEqual({ providerCustomerId: 'ctm_1', email: 'user@example.com', name: 'User' });
    expect(create).toHaveBeenCalledWith({ email: 'user@example.com', name: 'User' });
  });
});
