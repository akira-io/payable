import { expect, it } from 'vitest';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

const createIdempotencyRecord = (
  key: string,
  requestHash: string,
  lockedUntil: Date | null = null,
) => ({
  key,
  scope: key.split(':')[0] ?? 'catalog',
  operation: 'create',
  resourceType: null,
  resourceId: null,
  requestHash,
  response: null,
  status: 'processing' as const,
  lockedUntil,
  expiresAt: null,
});

export function registerSystemContract(ctx: ContractContext): void {
  it('isolates idempotency records by tenant and full scoped key', async () => {
    const { idempotency } = ctx.harness();
    const product = createIdempotencyRecord('catalog.product.create:shared', 'product-a');
    const price = createIdempotencyRecord('catalog.price.create:shared', 'price-a');
    expect(await idempotency.acquire(product, 'tenant-a')).toBe(true);
    expect(await idempotency.acquire(product, 'tenant-b')).toBe(true);
    expect(await idempotency.acquire(price, 'tenant-a')).toBe(true);
    expect(await idempotency.acquire(product, 'tenant-a')).toBe(false);
    await idempotency.markCompleted(product.key, { productId: 'prod_1' }, 'tenant-a');
    expect((await idempotency.find(product.key, 'tenant-a'))?.status).toBe('completed');
    expect((await idempotency.find(product.key, 'tenant-a'))?.response).toEqual({
      productId: 'prod_1',
    });
    expect((await idempotency.find(product.key, 'tenant-b'))?.status).toBe('processing');
    expect((await idempotency.find(price.key, 'tenant-a'))?.requestHash).toBe('price-a');
  });

  it('takes over an idempotency key only after its supplied long lease expires', async () => {
    const { idempotency, clock } = ctx.harness();
    const original = createIdempotencyRecord(
      'catalog.product.create:long-lease',
      'hash-original',
      new Date(CONTRACT_BASE_TIME.getTime() + 86_400_000),
    );
    expect(await idempotency.acquire(original)).toBe(true);
    const takeover = () =>
      idempotency.takeOver({ ...original, requestHash: 'hash-takeover', lockToken: 'token-b' });
    clock.advance(86_399_999);
    expect(await takeover()).toBe(false);
    clock.advance(2);
    expect(await takeover()).toBe(true);
    expect((await idempotency.find(original.key))?.requestHash).toBe('hash-takeover');
  });

  it('deduplicates and claims webhook events', async () => {
    const { storage, clock } = ctx.harness();
    const occurredAt = new Date('2026-07-14T10:00:00.000Z');
    const created = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_1',
      type: 'payment_intent.succeeded',
      normalizedType: 'payment.succeeded',
      payload: '{"raw":true}',
      signature: 'sig',
      data: { object: 'payment_intent' },
      headers: { 'x-test': '1' },
      status: 'pending',
      correlationId: 'corr-1',
      occurredAt,
      receivedAt: clock.now(),
    });

    const found = await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1');
    expect(found?.id).toBe(created.id);
    expect(found?.data).toEqual({ object: 'payment_intent' });
    expect(found?.occurredAt).toEqual(occurredAt);

    const token = await storage.webhookEvents.claim(created.id);
    expect(token).not.toBeNull();
    expect(await storage.webhookEvents.claim(created.id)).toBeNull();

    const wrong = await storage.webhookEvents.markStatus(
      created.id,
      'processed',
      clock.now(),
      undefined,
      'wrong-token',
    );
    expect(wrong).toBeNull();

    const ok = await storage.webhookEvents.markStatus(
      created.id,
      'processed',
      clock.now(),
      undefined,
      token,
    );
    expect(ok?.status).toBe('processed');
  });

  it('persists webhook endpoints and idempotent deliveries', async () => {
    const { storage } = ctx.harness();
    const endpoint = await storage.webhookEndpoints.create({
      tenantId: null,
      url: 'https://example.com/hooks',
      events: ['payment.succeeded'],
      secret: 'whsec_test',
      status: 'enabled',
    });
    expect(endpoint.secret).toBe('whsec_test');
    expect(endpoint.events).toEqual(['payment.succeeded']);
    expect((await storage.webhookEndpoints.listEnabledForEvent('payment.succeeded')).length).toBe(
      1,
    );

    await storage.webhookEndpoints.setStatus(endpoint.id, 'disabled');
    expect(await storage.webhookEndpoints.listEnabledForEvent('payment.succeeded')).toHaveLength(0);

    await storage.webhookDeliveries.record({
      tenantId: null,
      endpointId: endpoint.id,
      eventId: 'evt_d',
      eventType: 'payment.succeeded',
      payload: { ok: true },
      status: 'failed',
      attempts: 1,
      responseCode: 500,
      responseBody: 'err',
    });
    await storage.webhookDeliveries.record({
      tenantId: null,
      endpointId: endpoint.id,
      eventId: 'evt_d',
      eventType: 'payment.succeeded',
      payload: { ok: true },
      status: 'delivered',
      attempts: 2,
      responseCode: 200,
      responseBody: 'ok',
    });

    const deliveries = await storage.webhookDeliveries.listForEvent('evt_d');
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]?.status).toBe('delivered');
    expect(deliveries[0]?.attempts).toBe(2);
  });

  it('persists a verifiable audit chain', async () => {
    const { storage } = ctx.harness();
    await storage.auditLogs.create({
      tenantId: null,
      correlationId: 'corr-1',
      actorType: null,
      actorId: null,
      action: 'payment.charged',
      resourceType: 'payment',
      resourceId: 'pay_1',
      before: null,
      after: { amount: 9900 },
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });
    await storage.auditLogs.create({
      tenantId: null,
      correlationId: 'corr-2',
      actorType: null,
      actorId: null,
      action: 'payment.refunded',
      resourceType: 'payment',
      resourceId: 'pay_1',
      before: { amount: 9900 },
      after: { amount: 0 },
      metadata: null,
      ipAddress: null,
      userAgent: null,
    });

    const logs = await storage.auditLogs.list({ resourceType: 'payment' });
    expect(logs).toHaveLength(2);
    expect(logs[0]?.after).toEqual({ amount: 0 });
    expect(await storage.auditLogs.verifyChain(null)).toBe(true);
  });

  it('persists, deduplicates, and claims outbox events', async () => {
    const { storage, clock } = ctx.harness();
    const event = await storage.outboxEvents.create({
      tenantId: null,
      correlationId: 'corr-1',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { invoiceId: 'in_1' },
    });
    expect(event.status).toBe('pending');
    expect(event.attempts).toBe(0);

    const deduped = await storage.outboxEvents.create({
      tenantId: null,
      correlationId: 'corr-1',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { invoiceId: 'in_1' },
      dedupeKey: 'dedupe-1',
    });
    const dedupedAgain = await storage.outboxEvents.create({
      tenantId: null,
      correlationId: 'corr-2',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { invoiceId: 'in_1' },
      dedupeKey: 'dedupe-1',
    });
    expect(dedupedAgain.id).toBe(deduped.id);

    const claimed = await storage.outboxEvents.claimPending(10);
    const claimedFirst = claimed.find((candidate) => candidate.id === event.id);
    expect(claimedFirst?.lockToken).toBeTruthy();
    expect(await storage.outboxEvents.markPublished(event.id, claimedFirst?.lockToken)).toBe(1);

    const retryAt = new Date(clock.now().getTime() + 60_000);
    const other = claimed.find((candidate) => candidate.id === deduped.id);
    expect(await storage.outboxEvents.markFailed(deduped.id, retryAt, other?.lockToken)).toBe(1);
  });

  it('deduplicates concurrent tenantless outbox events', async () => {
    const { storage } = ctx.harness();
    const input = {
      tenantId: null,
      correlationId: 'corr-race',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: { invoiceId: 'in_race' },
      dedupeKey: 'tenantless-race-1',
    };

    const results = await Promise.all([
      storage.outboxEvents.create(input),
      storage.outboxEvents.create(input),
    ]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const claimed = await storage.outboxEvents.claimPending(100);
    expect(claimed.filter((event) => event.dedupeKey === 'tenantless-race-1')).toHaveLength(1);
  });

  it('keeps tenant-scoped outbox deduplication independent per tenant', async () => {
    const { storage } = ctx.harness();
    const base = {
      correlationId: 'corr-tenants',
      eventType: 'invoice.paid.v1',
      eventVersion: 1,
      payload: {},
      dedupeKey: 'shared-key',
    };

    const first = await storage.outboxEvents.create({ ...base, tenantId: 'tenant-a' });
    const second = await storage.outboxEvents.create({ ...base, tenantId: 'tenant-b' });
    const repeat = await storage.outboxEvents.create({ ...base, tenantId: 'tenant-a' });
    expect(first.id).not.toBe(second.id);
    expect(repeat.id).toBe(first.id);
  });

  it('deduplicates concurrent tenantless webhook deliveries', async () => {
    const { storage } = ctx.harness();
    const delivery = {
      tenantId: null,
      endpointId: 'ep_race',
      eventId: 'evt_race',
      eventType: 'invoice.paid',
      payload: { a: 1 },
      status: 'failed' as const,
      attempts: 1,
      responseCode: null,
      responseBody: null,
    };

    const [first, second] = await Promise.all([
      storage.webhookDeliveries.record(delivery),
      storage.webhookDeliveries.record({ ...delivery, status: 'delivered' as const, attempts: 2 }),
    ]);

    expect(first.id).toBe(second.id);
    expect(await storage.webhookDeliveries.listForEvent('evt_race')).toHaveLength(1);
  });
}
