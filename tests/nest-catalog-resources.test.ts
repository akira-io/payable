import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import type { NestPayableOptions } from '../src/presentation/nest/payable.constants';
import { PayableController } from '../src/presentation/nest/payable.controller';
import { PayableAuthGuard } from '../src/presentation/nest/payable-auth.guard';
import { PayableReadController } from '../src/presentation/nest/payable-read.controller';
import { payableErrorStatus } from '../src/presentation/shared/payable-http';
import { FakeProvider } from './support/fake-provider';

const request = { headers: {} };

function controllers(provider: FakeProvider, options: NestPayableOptions = {}) {
  const payable = createPayable({ providers: { stripe: provider }, tenant: { enabled: true } });
  return {
    read: new PayableReadController(payable, options),
    write: new PayableController(payable, options),
  };
}

describe('nest catalog resources', () => {
  it('lists and retrieves catalog resources with their filters intact', async () => {
    const provider = new FakeProvider();
    let tenantResolutions = 0;
    const { read } = controllers(provider, {
      resolveTenant: () => {
        tenantResolutions += 1;
        return 'tenant-a';
      },
    });

    const products = await read.listProducts(request, {
      limit: '25',
      cursor: 'products-cursor',
      active: 'false',
    });
    expect(products.data[0]).toMatchObject({ providerProductId: 'prod_fake' });
    expect(provider.lastListProducts).toEqual({
      limit: 25,
      cursor: 'products-cursor',
      active: false,
    });
    await expect(read.getProduct(request, 'prod_fake')).resolves.toMatchObject({
      providerProductId: 'prod_fake',
    });

    const prices = await read.listPrices(request, {
      limit: '30',
      cursor: 'prices-cursor',
      active: 'false',
      providerProductId: 'prod_fake',
    });
    expect(prices.data[0]).toMatchObject({ providerPriceId: 'price_fake' });
    expect(provider.lastListPrices).toEqual({
      limit: 30,
      cursor: 'prices-cursor',
      active: false,
      providerProductId: 'prod_fake',
    });
    await expect(read.getPrice(request, 'price_fake')).resolves.toMatchObject({
      providerPriceId: 'price_fake',
    });
    expect(tenantResolutions).toBe(4);
  });

  it('runs catalog lifecycle operations through guarded Nest endpoints', async () => {
    const provider = new FakeProvider();
    const { write } = controllers(provider, { resolveTenant: () => 'tenant-a' });

    await expect(write.activateProduct(request, 'prod_fake')).resolves.toMatchObject({
      active: true,
    });
    await expect(write.archiveProduct(request, 'prod_fake')).resolves.toMatchObject({
      active: false,
    });
    await expect(write.activatePrice(request, 'price_fake')).resolves.toMatchObject({
      active: true,
    });
    await expect(write.archivePrice(request, 'price_fake')).resolves.toMatchObject({
      active: false,
    });
    expect(provider.productActiveCalls.map(({ active }) => active)).toEqual([true, false]);
    expect(provider.priceActiveCalls.map(({ active }) => active)).toEqual([true, false]);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PayableController.prototype.activateProduct),
    ).toContain(PayableAuthGuard);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, PayableController.prototype.archivePrice),
    ).toContain(PayableAuthGuard);
  });

  it('preserves catalog 404 and validation error mappings', async () => {
    const provider = new FakeProvider();
    provider.retrieveProduct = async () => {
      throw new PayableError('Product not found', { code: 'PRODUCT_NOT_FOUND' });
    };
    const { read } = controllers(provider, { resolveTenant: () => 'tenant-a' });

    await expect(read.getProduct(request, 'missing')).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
    try {
      await read.listPrices(request, { limit: '0' });
      throw new Error('expected catalog query validation to fail');
    } catch (error) {
      expect(error).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(payableErrorStatus(error)).toBe(422);
    }
  });
});
