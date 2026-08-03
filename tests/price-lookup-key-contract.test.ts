import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { revivePrice } from '../src/application/services/catalog/catalog-idempotency-result';
import type { PriceLookupKeyCapable } from '../src/domain/contracts';
import * as domain from '../src/domain/contracts';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';
import type { ProviderCapabilities } from '../src/domain/dtos/capabilities.dto';
import type { ListPricesInput } from '../src/domain/dtos/catalog.dto';
import type { CreatePriceInput, TransferPriceLookupKeyInput } from '../src/domain/dtos/price.dto';
import { Money } from '../src/domain/value-objects/money';
import type {
  CreatePriceInput as RootCreatePriceInput,
  ListPricesInput as RootListPricesInput,
  PriceLookupKeyCapable as RootPriceLookupKeyCapable,
  TransferPriceLookupKeyInput as RootTransferPriceLookupKeyInput,
} from '../src/index';
import * as payable from '../src/index';
import { toPriceDTO as toPaddlePriceDTO } from '../src/infrastructure/providers/paddle/paddle-mappers';
import type { PaddlePriceEntity } from '../src/infrastructure/providers/paddle/paddle-types';
import { toPriceDTO as toStripePriceDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';

const createWithLookup = {
  providerProductId: 'prod_1',
  unitAmount: Money.of(1000, 'USD'),
  lookupKey: 'standard_monthly',
  transferLookupKey: true,
} satisfies CreatePriceInput & RootCreatePriceInput;

const lookupList = { lookupKeys: ['standard_monthly'] } satisfies ListPricesInput &
  RootListPricesInput;

const transferInput: TransferPriceLookupKeyInput & RootTransferPriceLookupKeyInput = {
  providerPriceId: 'price_1',
  lookupKey: 'standard_monthly',
};

const advertisedCapabilities: ProviderCapabilities = new Set(['priceLookupKeys']);

describe('price lookup key public contract', () => {
  it('recognizes only providers that implement every lookup key operation', () => {
    const partial = {
      name: 'partial',
      createPrice: async () => toStripePriceDTO({} as Stripe.Price),
      listPrices: async () => ({ data: [], nextCursor: null }),
    } as unknown as PaymentProvider;
    const operations = {
      createPrice: async () => toStripePriceDTO({} as Stripe.Price),
      listPrices: async () => ({ data: [], nextCursor: null }),
      transferPriceLookupKey: async () => toStripePriceDTO({} as Stripe.Price),
    } satisfies PriceLookupKeyCapable;
    const rootOperations: RootPriceLookupKeyCapable = operations;
    const capable = { name: 'capable', ...operations } as unknown as PaymentProvider;

    expect(domain.isPriceLookupKeyCapable(partial)).toBe(false);
    expect(domain.isPriceLookupKeyCapable(capable)).toBe(true);
    expect(advertisedCapabilities.has('priceLookupKeys')).toBe(true);
    expect(createWithLookup.lookupKey).toBe('standard_monthly');
    expect(lookupList.lookupKeys).toEqual(['standard_monthly']);
    expect(transferInput.lookupKey).toBe('standard_monthly');
    expect(rootOperations.transferPriceLookupKey).toBeTypeOf('function');
  });

  it('exports the lookup key contract from the domain and package root', () => {
    expect(typeof domain.isPriceLookupKeyCapable).toBe('function');
    expect(typeof payable.isPriceLookupKeyCapable).toBe('function');
  });

  it('maps absent provider lookup keys as null', () => {
    const stripe = toStripePriceDTO({
      id: 'price_stripe',
      product: 'prod_1',
      unit_amount: 1000,
      currency: 'usd',
      active: true,
    } as unknown as Stripe.Price);
    const paddle = toPaddlePriceDTO({
      id: 'price_paddle',
      productId: 'prod_1',
      unitPrice: { amount: '1000', currencyCode: 'USD' },
      status: 'active',
    } as PaddlePriceEntity);

    expect(stripe.lookupKey).toBeNull();
    expect(paddle.lookupKey).toBeNull();
  });

  it('revives lookup keys from current and legacy stored prices', () => {
    const current = revivePrice({
      providerPriceId: 'price_current',
      providerProductId: 'prod_1',
      lookupKey: 'standard_monthly',
      unitAmount: { amount: 1000, currency: 'USD' },
      interval: 'month',
      intervalCount: 1,
      description: null,
      active: true,
    });
    const legacy = revivePrice({
      providerPriceId: 'price_legacy',
      providerProductId: 'prod_1',
      unitAmount: { amount: 1000, currency: 'USD' },
      interval: 'month',
      intervalCount: 1,
      description: null,
      active: true,
    });

    expect(current.lookupKey).toBe('standard_monthly');
    expect(legacy.lookupKey).toBeNull();
  });

  it('rejects stored prices with an invalid present lookup key', () => {
    expect(() =>
      revivePrice({
        providerPriceId: 'price_invalid',
        providerProductId: 'prod_1',
        lookupKey: 123,
        unitAmount: { amount: 1000, currency: 'USD' },
        interval: 'month',
        intervalCount: 1,
        description: null,
        active: true,
      }),
    ).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_RESULT_PERSISTENCE_FAILED' }));
  });
});
