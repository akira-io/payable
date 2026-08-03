import Stripe from 'stripe';
import { vi } from 'vitest';

const LAST_RESPONSE = { headers: {}, requestId: 'req_1', statusCode: 200 };

const PRODUCT: Stripe.Response<Stripe.Product> = {
  id: 'prod_1',
  object: 'product',
  active: true,
  created: 1,
  default_price: null,
  description: 'Team plan',
  images: [],
  livemode: false,
  marketing_features: [],
  metadata: { tier: 'pro' },
  name: 'Pro',
  package_dimensions: null,
  shippable: null,
  statement_descriptor: null,
  tax_code: null,
  type: 'service',
  unit_label: null,
  updated: 1,
  url: null,
  lastResponse: LAST_RESPONSE,
};

const PRICE: Stripe.Response<Stripe.Price> = {
  id: 'price_1',
  object: 'price',
  active: true,
  billing_scheme: 'per_unit',
  created: 1,
  currency: 'usd',
  custom_unit_amount: null,
  livemode: false,
  lookup_key: null,
  metadata: {},
  nickname: 'Monthly plan',
  product: 'prod_1',
  recurring: null,
  tax_behavior: null,
  tiers_mode: null,
  transform_quantity: null,
  type: 'one_time',
  unit_amount: 9900,
  unit_amount_decimal: null,
  lastResponse: LAST_RESPONSE,
};

export function createStripeCatalogPrice(
  overrides: Partial<Stripe.Price> = {},
): Stripe.Response<Stripe.Price> {
  return { ...PRICE, ...overrides };
}

function createStripeCatalogPriceList(
  price: Stripe.Response<Stripe.Price>,
): Stripe.Response<Stripe.ApiList<Stripe.Price>> {
  return {
    object: 'list',
    url: '/v1/prices',
    data: [price],
    has_more: false,
    lastResponse: LAST_RESPONSE,
  };
}

export function createStripeCatalogClient(price = PRICE) {
  const client = new Stripe('sk_test');
  const productsCreate = vi.spyOn(client.products, 'create').mockResolvedValue(PRODUCT);
  const productsUpdate = vi.spyOn(client.products, 'update').mockResolvedValue(PRODUCT);
  const pricesCreate = vi.spyOn(client.prices, 'create').mockResolvedValue(price);
  const pricesUpdate = vi.spyOn(client.prices, 'update').mockResolvedValue(price);
  const pricesList = vi
    .spyOn(client.prices, 'list')
    .mockResolvedValue(createStripeCatalogPriceList(price));
  return { client, productsCreate, productsUpdate, pricesCreate, pricesUpdate, pricesList };
}
