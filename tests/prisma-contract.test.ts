import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { Money } from '../src/domain/value-objects/money';
import { NodeEncryptionDriver } from '../src/infrastructure/encryption/node-encryption-driver';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createPrismaHarness, createPrismaTestClient, disconnectPrisma } from './support/prisma';
import { describeStorageContract } from './support/storage-contract';

describeStorageContract('Prisma', createPrismaHarness);

let prisma: PrismaClientLike;
let storage: PrismaStorageDriver;

beforeAll(async () => {
  prisma = await createPrismaTestClient();
  const encryption = new NodeEncryptionDriver({ key: 'a-storage-key', salt: 'a-storage-salt' });
  storage = new PrismaStorageDriver(prisma, new FakeClock(), encryption);
}, 120_000);

afterAll(async () => {
  await disconnectPrisma(prisma);
});

describe('prisma encryption at rest', () => {
  it('converges concurrent null-tenant creation on one logical customer', async () => {
    const payable = createPayable({ providers: { stripe: new FakeProvider() }, storage });
    const billable = {
      billableType: 'User',
      billableId: 'prisma-concurrent-customer',
      email: 'concurrent@example.com',
    };

    const customers = await Promise.all([
      payable.customers().create(billable),
      payable.customers().create(billable),
    ]);

    expect(customers[0]?.id).toBe(customers[1]?.id);
  });

  it('stores outbox payloads as ciphertext and decrypts on read', async () => {
    const created = await storage.outboxEvents.create({
      tenantId: null,
      correlationId: 'corr-outbox',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { providerEventId: 'evt_prisma', data: { email: 'outbox@example.com' } },
      dedupeKey: 'prisma-outbox-1',
    });
    expect(created.payload).toMatchObject({ data: { email: 'outbox@example.com' } });

    const raw = await prisma.payableOutboxEvent.findFirst({ where: { id: created.id } });
    expect(raw?.payload).not.toContain('outbox@example.com');

    const [claimed] = await storage.outboxEvents.claimPending(1);
    expect(claimed?.payload).toMatchObject({ data: { email: 'outbox@example.com' } });
  });

  it('stores webhook delivery payloads as ciphertext and decrypts on read', async () => {
    const recorded = await storage.webhookDeliveries.record({
      tenantId: null,
      endpointId: 'ep_prisma',
      eventId: 'evt_prisma_delivery',
      eventType: 'invoice.paid',
      payload: { providerEventId: 'evt_prisma_delivery', data: { email: 'deliver@example.com' } },
      status: 'delivered',
      attempts: 1,
      responseCode: 200,
      responseBody: null,
    });
    expect(recorded.payload).toMatchObject({ data: { email: 'deliver@example.com' } });

    const raw = await prisma.payableWebhookDelivery.findFirst({ where: { id: recorded.id } });
    expect(raw?.payload).not.toContain('deliver@example.com');

    const [delivery] = await storage.webhookDeliveries.listForEvent('evt_prisma_delivery');
    expect(delivery?.payload).toMatchObject({ data: { email: 'deliver@example.com' } });
  });

  it('stores webhook event data as ciphertext and decrypts on read', async () => {
    await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_prisma_event',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{"email":"event@example.com"}',
      signature: 'sig-secret',
      data: { email: 'event@example.com' },
      headers: {},
      status: 'pending',
      correlationId: 'corr-event',
      occurredAt: null,
      receivedAt: new Date('2026-06-22T00:00:00.000Z'),
    });

    const raw = await prisma.payableWebhookEvent.findFirst({
      where: { providerEventId: 'evt_prisma_event' },
    });
    expect(raw?.payload).not.toContain('event@example.com');
    expect(raw?.data).not.toContain('event@example.com');

    const event = await storage.webhookEvents.findByProviderEvent('stripe', 'evt_prisma_event');
    expect(event?.data).toEqual({ email: 'event@example.com' });
  });
});

describe('prisma subscription lifecycle metadata', () => {
  it('writes and reads lifecycle scheduling fields through the storage driver', async () => {
    const created = await storage.subscriptions.create({
      tenantId: null,
      customerId: 'prisma-lifecycle-customer',
      name: 'prisma-lifecycle-subscription',
      provider: 'paddle',
      providerSubscriptionId: 'sub_prisma_lifecycle',
      status: 'active',
      priceId: 'price_prisma_lifecycle',
      quantity: 1,
      trialEndsAt: null,
      endsAt: null,
      currentPeriodStart: new Date('2026-08-01T00:00:00.000Z'),
      currentPeriodEnd: new Date('2026-09-01T00:00:00.000Z'),
      providerSyncedAt: new Date('2026-08-07T10:00:00.000Z'),
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-10-01T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
      paymentCollectionPauseBehavior: 'keepAsDraft',
      paymentCollectionResumesAt: new Date('2026-09-15T00:00:00.000Z'),
    });

    expect(await storage.subscriptions.findById(created.id)).toMatchObject({
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-09-01T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-10-01T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
      paymentCollectionPauseBehavior: 'keepAsDraft',
      paymentCollectionResumesAt: new Date('2026-09-15T00:00:00.000Z'),
    });
  });
});

describe('prisma canonical local catalog', () => {
  it('persists provider-neutral products and prices', async () => {
    const payable = createPayable({ storage });
    const product = await payable.products().create({ name: 'Canonical Pro' });
    const price = await payable.prices().create({
      productId: product.id,
      unitAmount: Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
      lookupKey: 'canonical_pro_monthly',
    });

    await expect(payable.products().retrieve(product.id)).resolves.toEqual(product);
    await expect(payable.prices().retrieve(price.id)).resolves.toEqual(price);
  });

  it('paginates equal timestamps and persists independent provider bindings', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const products = payable.products('prisma-canonical-tenant');
    const first = await products.create({ name: 'Starter' });
    const second = await products.create({ name: 'Pro' });
    const firstPage = await products.list({ limit: 1 });
    const secondPage = await products.list({
      limit: 1,
      cursor: firstPage.nextCursor ?? undefined,
    });

    await storage.productProviderBindings.create({
      tenantId: 'prisma-canonical-tenant',
      productId: first.id,
      provider: 'stripe-primary',
      providerProductId: 'prod_prisma_primary',
    });
    await storage.productProviderBindings.create({
      tenantId: 'prisma-canonical-tenant',
      productId: first.id,
      provider: 'stripe-secondary',
      providerProductId: 'prod_prisma_secondary',
    });

    expect([...firstPage.data, ...secondPage.data].map(({ id }) => id).sort()).toEqual(
      [first.id, second.id].sort(),
    );
    await expect(
      storage.productProviderBindings.listByProductId(first.id, 'prisma-canonical-tenant'),
    ).resolves.toHaveLength(2);
  });
});

describe('prisma canonical local subscriptions', () => {
  it('persists accepted terms and a separate provider binding', async () => {
    const payable = createPayable({ storage, tenant: { enabled: true } });
    const tenantId = 'prisma-subscription-tenant';
    const customer = await payable.customers(undefined, tenantId).create({
      billableType: 'Team',
      billableId: 'prisma-subscription-team',
      email: 'subscription@example.com',
    });
    const product = await payable.products(tenantId).create({ name: 'Subscription Pro' });
    const price = await payable.prices(tenantId).create({
      productId: product.id,
      unitAmount: Money.of(4200, 'EUR'),
      type: 'recurring',
      interval: 'month',
    });

    const subscription = await payable.canonicalSubscriptions(tenantId).create({
      customerId: customer.id,
      name: 'default',
      priceId: price.id,
      quantity: 2,
      activation: { state: 'pending' },
      collectionResponsibility: 'merchant',
      source: 'api',
    });
    const binding = await payable.canonicalSubscriptions(tenantId).attachProvider(subscription.id, {
      provider: 'stripe-primary',
      providerSubscriptionId: 'sub_prisma_canonical',
    });

    await expect(storage.subscriptions.findById(subscription.id, tenantId)).resolves.toMatchObject({
      provider: null,
      providerSubscriptionId: null,
      acceptedUnitAmount: 4200,
      acceptedQuantity: 2,
    });
    await expect(
      storage.subscriptionProviderBindings.findByProviderId(
        'stripe-primary',
        'sub_prisma_canonical',
        tenantId,
      ),
    ).resolves.toEqual(binding);
  });
});

describe('prisma catalog synchronization', () => {
  it('persists and updates tenant-scoped synchronization state', async () => {
    const created = await storage.catalogSynchronizations.save({
      tenantId: 'prisma-sync-tenant',
      provider: 'stripe-primary',
      resourceType: 'product',
      resourceId: globalThis.crypto.randomUUID(),
      operation: 'create',
      canonicalVersion: 'v1',
      idempotencyKey: 'payable:catalog-sync:v1:prisma',
      status: 'requested',
      reconciliationState: 'pending',
      providerResourceId: null,
      providerResourceVersion: null,
      retryCount: 0,
      lastErrorCode: null,
      lastAttemptedAt: null,
      lastSucceededAt: null,
    });
    const updated = await storage.catalogSynchronizations.update(
      'product',
      created.resourceId,
      'stripe-primary',
      { status: 'succeeded', providerResourceId: 'prod_prisma' },
      'prisma-sync-tenant',
    );

    expect(updated).toMatchObject({ status: 'succeeded', providerResourceId: 'prod_prisma' });
    await expect(
      storage.catalogSynchronizations.findByResource(
        'product',
        created.resourceId,
        'stripe-primary',
        'another-tenant',
      ),
    ).resolves.toBeNull();
  });
});
