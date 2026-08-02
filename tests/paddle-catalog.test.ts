import { describe, expect, it, vi } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type { PaddleClient } from '../src/infrastructure/providers/paddle/paddle-types';
import { InMemoryIdempotencyStore } from './support/fakes';

const operationContext = {
  correlationId: 'corr-1',
  idempotencyKey: `payable:catalog:v1:${'a'.repeat(64)}`,
};

describe('Paddle catalog', () => {
  it('reads, lists, and updates catalog resources with normalized fields', async () => {
    const productOne = {
      id: 'pro_1',
      name: 'Pro',
      description: 'For teams',
      customData: { tier: 'pro', seats: 5 },
      status: 'active',
    };
    const productTwo = {
      id: 'pro_2',
      name: 'Archived Pro',
      description: null,
      customData: { tier: 'archived' },
      status: 'archived',
    };
    const priceOne = {
      id: 'pri_1',
      productId: 'pro_1',
      description: 'Monthly plan',
      unitPrice: { amount: '9900', currencyCode: 'USD' },
      billingCycle: { interval: 'month', frequency: 3 },
      status: 'active',
    };
    const priceTwo = {
      id: 'pri_2',
      productId: 'pro_1',
      description: 'Archived monthly plan',
      unitPrice: { amount: '1500', currencyCode: 'EUR' },
      billingCycle: null,
      status: 'archived',
    };
    const productsNext = vi.fn().mockResolvedValue([productOne, productTwo]);
    const pricesNext = vi.fn().mockResolvedValue([priceOne, priceTwo]);
    const productsList = vi.fn(() => ({ hasMore: true, next: productsNext }));
    const pricesList = vi.fn(() => ({ hasMore: true, next: pricesNext }));
    const productsCreate = vi.fn().mockResolvedValue(productOne);
    const pricesCreate = vi.fn().mockResolvedValue(priceOne);
    const productsUpdate = vi.fn().mockResolvedValue({ ...productOne, status: 'archived' });
    const pricesUpdate = vi.fn().mockResolvedValue({ ...priceOne, status: 'archived' });
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      products: {
        create: productsCreate,
        update: productsUpdate,
        get: vi.fn().mockResolvedValue(productOne),
        list: productsList,
      },
      prices: {
        create: pricesCreate,
        update: pricesUpdate,
        get: vi.fn().mockResolvedValue(priceOne),
        list: pricesList,
      },
    } as unknown as PaddleClient);

    await expect(paddle.retrieveProduct('pro_1')).resolves.toMatchObject({
      description: 'For teams',
      active: true,
      metadata: { tier: 'pro' },
    });
    await expect(
      paddle.listProducts({ limit: 2, cursor: 'pro_prev', active: false }),
    ).resolves.toMatchObject({
      data: [
        { providerProductId: 'pro_1', metadata: { tier: 'pro' } },
        { providerProductId: 'pro_2', active: false, metadata: { tier: 'archived' } },
      ],
      nextCursor: 'pro_2',
    });
    await expect(paddle.retrievePrice('pri_1')).resolves.toMatchObject({
      description: 'Monthly plan',
      interval: 'month',
      intervalCount: 3,
      active: true,
    });
    await expect(
      paddle.listPrices({
        limit: 2,
        cursor: 'pri_prev',
        active: false,
        providerProductId: 'pro_1',
      }),
    ).resolves.toMatchObject({
      data: [
        { providerPriceId: 'pri_1', description: 'Monthly plan' },
        { providerPriceId: 'pri_2', active: false, interval: null, intervalCount: null },
      ],
      nextCursor: 'pri_2',
    });
    await paddle.createProduct({ name: 'Pro' }, operationContext);
    await paddle.updateProduct({ providerProductId: 'pro_1', name: 'Pro v2' }, operationContext);
    await paddle.createPrice(
      { providerProductId: 'pro_1', unitAmount: Money.of(9900, 'USD') },
      operationContext,
    );
    await paddle.setProductActive('pro_1', false, operationContext);
    await paddle.setPriceActive('pri_1', false, operationContext);

    expect(productsList).toHaveBeenCalledWith({
      status: ['archived'],
      perPage: 2,
      after: 'pro_prev',
    });
    expect(pricesList).toHaveBeenCalledWith({
      status: ['archived'],
      perPage: 2,
      after: 'pri_prev',
      productId: ['pro_1'],
    });
    expect(productsNext).toHaveBeenCalledOnce();
    expect(pricesNext).toHaveBeenCalledOnce();
    expect(productsCreate).toHaveBeenCalledWith({
      name: 'Pro',
      taxCategory: 'standard',
      description: undefined,
      customData: undefined,
    });
    expect(productsUpdate).toHaveBeenNthCalledWith(1, 'pro_1', {
      name: 'Pro v2',
      description: undefined,
      status: undefined,
    });
    expect(pricesCreate).toHaveBeenCalledWith({
      productId: 'pro_1',
      description: 'One-time price',
      unitPrice: { amount: '9900', currencyCode: 'USD' },
      billingCycle: undefined,
    });
    expect(productsUpdate).toHaveBeenNthCalledWith(2, 'pro_1', { status: 'archived' });
    expect(pricesUpdate).toHaveBeenCalledWith('pri_1', { status: 'archived' });
    expect(productsCreate.mock.calls[0]).toHaveLength(1);
    expect(productsUpdate.mock.calls[0]).toHaveLength(2);
    expect(productsUpdate.mock.calls[1]).toHaveLength(2);
    expect(pricesCreate.mock.calls[0]).toHaveLength(1);
    expect(pricesUpdate.mock.calls[0]).toHaveLength(2);
    expect(paddle.capabilities().has('catalogRead')).toBe(true);
    expect(paddle.capabilities().has('catalogLifecycle')).toBe(true);
    expect(paddle.capabilities().has('catalogIdempotency')).toBe(false);

    productsCreate.mockClear();
    const products = createPayable({
      providers: { paddle },
      idempotency: { store: new InMemoryIdempotencyStore() },
    }).products('paddle');
    const createInput = { name: 'Pro', description: 'For teams', metadata: { tier: 'pro' } };
    const createdProduct = await products.create(createInput, {
      idempotencyKey: 'product-create-1',
    });
    const replayedProduct = await products.create(createInput, {
      idempotencyKey: 'product-create-1',
    });

    expect(replayedProduct).toEqual(createdProduct);
    expect(replayedProduct).toEqual({
      providerProductId: 'pro_1',
      name: 'Pro',
      description: 'For teams',
      active: true,
      metadata: { tier: 'pro' },
    });
    expect(productsCreate).toHaveBeenCalledOnce();
  });

  it('uses Paddle default product status when activity is omitted or true', async () => {
    const product = { id: 'pro_1', name: 'Pro', status: 'active' };
    const create = vi.fn().mockResolvedValue(product);
    const update = vi.fn();
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      products: { create, update },
    } as unknown as PaddleClient);

    await expect(paddle.createProduct({ name: 'Pro' }, operationContext)).resolves.toMatchObject({
      active: true,
    });
    await expect(
      paddle.createProduct({ name: 'Pro', active: true }, operationContext),
    ).resolves.toMatchObject({ active: true });

    expect(create).toHaveBeenNthCalledWith(1, {
      name: 'Pro',
      taxCategory: 'standard',
      description: undefined,
      customData: undefined,
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      name: 'Pro',
      taxCategory: 'standard',
      description: undefined,
      customData: undefined,
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('archives products created with active false', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pro_1', name: 'Pro', status: 'active' });
    const update = vi.fn().mockResolvedValue({ id: 'pro_1', name: 'Pro', status: 'archived' });
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      products: { create, update },
    } as unknown as PaddleClient);

    await expect(
      paddle.createProduct({ name: 'Pro', active: false }, operationContext),
    ).resolves.toMatchObject({ active: false });

    expect(create).toHaveBeenCalledWith({
      name: 'Pro',
      taxCategory: 'standard',
      description: undefined,
      customData: undefined,
    });
    expect(update).toHaveBeenCalledWith('pro_1', { status: 'archived' });
  });

  it('propagates normalized errors when product archiving fails after creation', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'pro_1', name: 'Pro', status: 'active' });
    const update = vi.fn().mockRejectedValue({ code: 'not_found', detail: 'missing' });
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      products: { create, update },
    } as unknown as PaddleClient);

    await expect(
      paddle.createProduct({ name: 'Pro', active: false }, operationContext),
    ).rejects.toMatchObject({ code: 'PRODUCT_NOT_FOUND' });

    expect(create).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledWith('pro_1', { status: 'archived' });
  });

  it('uses entity-specific not-found errors except for catalog lists', async () => {
    const missingError = { code: 'not_found', type: 'request_error', detail: 'missing' };
    const missing = () => Promise.reject(missingError);
    const paddle = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, {
      products: { get: missing, update: missing, list: missing },
      prices: { get: missing, update: missing },
    } as unknown as PaddleClient);

    await expect(paddle.retrieveProduct('pro_missing')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      context: {
        providerProductId: 'pro_missing',
        provider: 'paddle',
        paddleCode: 'not_found',
        paddleType: 'request_error',
      },
      cause: missingError,
    });
    await expect(
      paddle.setProductActive('pro_missing', false, operationContext),
    ).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
      correlationId: 'corr-1',
      context: {
        providerProductId: 'pro_missing',
        provider: 'paddle',
        paddleCode: 'not_found',
        paddleType: 'request_error',
      },
      cause: missingError,
    });
    await expect(paddle.retrievePrice('pri_missing')).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
      context: {
        providerPriceId: 'pri_missing',
        provider: 'paddle',
        paddleCode: 'not_found',
        paddleType: 'request_error',
      },
      cause: missingError,
    });
    await expect(
      paddle.setPriceActive('pri_missing', false, operationContext),
    ).rejects.toMatchObject({
      code: 'PRICE_NOT_FOUND',
      correlationId: 'corr-1',
      context: {
        providerPriceId: 'pri_missing',
        provider: 'paddle',
        paddleCode: 'not_found',
        paddleType: 'request_error',
      },
      cause: missingError,
    });
    await expect(paddle.listProducts()).rejects.toMatchObject({ code: 'PROVIDER_REQUEST_INVALID' });
  });
});
