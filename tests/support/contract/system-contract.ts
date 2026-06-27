import { expect, it } from 'vitest';
import { CONTRACT_BASE_TIME, type ContractContext } from './harness';

export function registerSystemContract(ctx: ContractContext): void {
  it('acquires an idempotency key once and reports duplicates', async () => {
    const record = {
      key: 'charge:1',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: 'hash-1',
      response: null,
      status: 'processing' as const,
      lockedUntil: null,
      expiresAt: null,
    };
    expect(await ctx.harness().idempotency.acquire(record)).toBe(true);
    expect(await ctx.harness().idempotency.acquire(record)).toBe(false);
  });

  it('replays a completed idempotency response', async () => {
    const { idempotency } = ctx.harness();
    await idempotency.put({
      key: 'charge:2',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: 'hash-2',
      response: null,
      status: 'processing',
      lockedUntil: new Date(CONTRACT_BASE_TIME.getTime() + 30_000),
      expiresAt: null,
    });
    await idempotency.markCompleted('charge:2', { paymentId: 'pay_1' });

    const completed = await idempotency.find('charge:2');
    expect(completed?.status).toBe('completed');
    expect(completed?.response).toEqual({ paymentId: 'pay_1' });
  });

  it('takes over an idempotency key after its lock expires', async () => {
    const { idempotency, clock } = ctx.harness();
    const original = {
      key: 'charge:3',
      scope: 'charge',
      operation: 'charge',
      resourceType: null,
      resourceId: null,
      requestHash: 'hash-3',
      response: null,
      status: 'processing' as const,
      lockedUntil: new Date(CONTRACT_BASE_TIME.getTime() + 30_000),
      expiresAt: null,
    };
    expect(await idempotency.acquire(original)).toBe(true);

    clock.advance(60_000);
    const takeover = await idempotency.takeOver({
      ...original,
      requestHash: 'hash-3b',
      lockedUntil: new Date(clock.now().getTime() + 30_000),
      lockToken: 'token-b',
    });
    expect(takeover).toBe(true);
    expect((await idempotency.find('charge:3'))?.requestHash).toBe('hash-3b');
  });

  it('deduplicates and claims webhook events', async () => {
    const { storage, clock } = ctx.harness();
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
      receivedAt: clock.now(),
    });

    const found = await storage.webhookEvents.findByProviderEvent('stripe', 'evt_1');
    expect(found?.id).toBe(created.id);
    expect(found?.data).toEqual({ object: 'payment_intent' });

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
}
