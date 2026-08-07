import type Stripe from 'stripe';
import { describe, expect, it } from 'vitest';
import { matchProviderSubscriptionItems } from '../src/application/services/subscriptions/match-provider-subscription-items';
import { toSubscriptionDTO as toPaddleSubscriptionDTO } from '../src/infrastructure/providers/paddle/paddle-mappers';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import type {
  PaddleClient,
  PaddleSubscriptionEntity,
} from '../src/infrastructure/providers/paddle/paddle-types';
import { toSubscriptionDTO as toStripeSubscriptionDTO } from '../src/infrastructure/providers/stripe/stripe-mappers';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';

const context = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };

describe('subscription provider item identities', () => {
  it('matches duplicate prices by quantity before provider response order', () => {
    const localItems = [
      { priceId: 'price_shared', quantity: 1 },
      { priceId: 'price_shared', quantity: 3 },
    ];

    expect(
      matchProviderSubscriptionItems(localItems, [
        { providerItemId: 'si_three', priceId: 'price_shared', quantity: 3 },
        { providerItemId: 'si_one', priceId: 'price_shared', quantity: 1 },
      ]),
    ).toEqual([
      { providerItemId: 'si_one', priceId: 'price_shared', quantity: 1 },
      { providerItemId: 'si_three', priceId: 'price_shared', quantity: 3 },
    ]);
  });

  it('deterministically matches indistinguishable duplicate prices with stable identities', () => {
    const localItems = [
      { priceId: 'price_shared', quantity: 1 },
      { priceId: 'price_shared', quantity: 1 },
    ];
    const first = matchProviderSubscriptionItems(localItems, [
      { providerItemId: 'si_z', priceId: 'price_shared', quantity: 1 },
      { providerItemId: 'si_a', priceId: 'price_shared', quantity: 1 },
    ]);
    const reordered = matchProviderSubscriptionItems(localItems, [
      { providerItemId: 'si_a', priceId: 'price_shared', quantity: 1 },
      { providerItemId: 'si_z', priceId: 'price_shared', quantity: 1 },
    ]);

    expect(first).toEqual([
      { providerItemId: 'si_a', priceId: 'price_shared', quantity: 1 },
      { providerItemId: 'si_z', priceId: 'price_shared', quantity: 1 },
    ]);
    expect(reordered).toEqual(first);
  });

  it('leaves indistinguishable duplicates unmatched when provider identities are missing', () => {
    const localItems = [
      { priceId: 'price_shared', quantity: 1 },
      { priceId: 'price_shared', quantity: 1 },
    ];

    expect(
      matchProviderSubscriptionItems(localItems, [
        { providerItemId: null, priceId: 'price_shared', quantity: 1 },
        { providerItemId: null, priceId: 'price_shared', quantity: 1 },
      ]),
    ).toEqual([
      { providerItemId: null, priceId: 'price_shared', quantity: 1 },
      { providerItemId: null, priceId: 'price_shared', quantity: 1 },
    ]);
  });

  it('maps stable Stripe item identities without relying on item order', () => {
    const dto = toStripeSubscriptionDTO({
      id: 'sub_items',
      status: 'active',
      trial_end: null,
      items: {
        data: [
          { id: 'si_addon', price: { id: 'price_addon' }, quantity: 2 },
          { id: 'si_primary', price: { id: 'price_primary' }, quantity: 1 },
        ],
      },
    } as unknown as Stripe.Subscription);

    expect(dto.items).toEqual([
      { providerItemId: 'si_addon', priceId: 'price_addon', quantity: 2 },
      { providerItemId: 'si_primary', priceId: 'price_primary', quantity: 1 },
    ]);
  });

  it('maps Paddle price identities without fabricating stable item ids', () => {
    const dto = toPaddleSubscriptionDTO({
      id: 'sub_items',
      status: 'active',
      items: [
        { price: { id: 'pri_addon' }, quantity: 2 },
        { price: { id: 'pri_primary' }, quantity: 1 },
      ],
    } as unknown as PaddleSubscriptionEntity);

    expect(dto.items).toEqual([
      { providerItemId: null, priceId: 'pri_addon', quantity: 2 },
      { providerItemId: null, priceId: 'pri_primary', quantity: 1 },
    ]);
  });

  it('updates the mapped Stripe item without reading the first provider item', async () => {
    let retrieved = false;
    let updateParams: unknown;
    const stripe = {
      subscriptions: {
        retrieve: () => {
          retrieved = true;
          return Promise.resolve({ items: { data: [{ id: 'si_wrong' }] } });
        },
        update: (_id: string, params: unknown) => {
          updateParams = params;
          return Promise.resolve({ id: 'sub_1', status: 'active', items: { data: [] } });
        },
      },
    } as unknown as Stripe;
    const provider = new StripeProvider({ secretKey: 'sk', webhookSecret: 'wh' }, stripe);

    await provider.updateSubscription(
      {
        providerSubscriptionId: 'sub_1',
        providerItemId: 'si_target',
        priceId: 'price_x',
        quantity: 3,
      },
      context,
    );

    expect(retrieved).toBe(false);
    expect(updateParams).toMatchObject({
      items: [{ id: 'si_target', price: 'price_x', quantity: 3 }],
    });
  });

  it('sends every local item when Paddle changes one item', async () => {
    let updateBody: unknown;
    const client = {
      subscriptions: {
        update: (_id: string, body: unknown) => {
          updateBody = body;
          return Promise.resolve({ id: 'sub_1', status: 'active' });
        },
      },
    } as unknown as PaddleClient;
    const provider = new PaddleProvider({ apiKey: 'pdl_test', webhookSecret: 'wh_test' }, client);

    await provider.updateSubscription(
      {
        providerSubscriptionId: 'sub_1',
        priceId: 'pri_new',
        quantity: 4,
        items: [
          { priceId: 'pri_primary', quantity: 1 },
          { priceId: 'pri_new', quantity: 4 },
          { priceId: 'pri_meter', quantity: 9 },
        ],
      },
      context,
    );

    expect(updateBody).toEqual({
      items: [
        { priceId: 'pri_primary', quantity: 1 },
        { priceId: 'pri_new', quantity: 4 },
        { priceId: 'pri_meter', quantity: 9 },
      ],
      prorationBillingMode: 'prorated_immediately',
    });
  });
});
