import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { countDuePendingOutbox, createTestDb } from './support/knex';

let db: Knex;
let clock: FakeClock;
let storage: KnexStorageDriver;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
});

afterEach(async () => {
  await db.destroy();
});

describe('webhook replay', () => {
  const verifyResult = {
    providerEventId: 'evt_1',
    type: 'invoice.paid',
    normalizedType: 'invoice.paid' as const,
    data: { id: 'in_1' },
  };

  it('re-runs the pipeline and is policy-gated', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const events = new InMemoryEventBus();
    let processed = 0;
    events.listen('webhook.processed', () => {
      processed += 1;
    });
    const payable = createPayable({ providers: { stripe: provider }, storage, events, clock });

    const received = await payable.receiveWebhook({ payload: '{}', signature: 'sig' });
    expect(processed).toBe(1);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(1);

    await payable.replayWebhook(received.webhookEventId, {
      allowed: true,
      actorType: 'user',
      actorId: 'admin-1',
    });
    expect(processed).toBe(2);
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(2);
    expect(await countDuePendingOutbox(db, clock)).toBe(1);

    await expect(payable.replayWebhook(received.webhookEventId)).rejects.toThrow('not permitted');
    await expect(payable.replayWebhook(received.webhookEventId, { allowed: true })).rejects.toThrow(
      'not permitted',
    );
    await expect(
      payable.replayWebhook(received.webhookEventId, { allowed: false, actorId: 'admin-1' }),
    ).rejects.toThrow('not permitted');
    await expect(
      payable.replayWebhook('missing', { allowed: true, actorId: 'admin-1' }),
    ).rejects.toThrow('not found');
  });

  it('claims the event before reprocessing a previously failed replay', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_replay_failed',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      signature: 'sig',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_replay',
      receivedAt: clock.now(),
    });

    await payable.replayWebhook(event.id, { allowed: true, actorType: 'user', actorId: 'admin-1' });

    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processed');
  });

  it('re-verifies the stored signature on replay and ignores tampered data', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = { ...verifyResult, data: { id: 'authoritative' } };
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_reverify',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{"signed":true}',
      signature: 'sig-1',
      data: { id: 'tampered' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_reverify',
      receivedAt: clock.now(),
    });

    await payable.replayWebhook(event.id, { allowed: true, actorId: 'admin-1' });

    expect(provider.lastVerifyInput?.payload).toBe('{"signed":true}');
    expect(provider.lastVerifyInput?.signature).toBe('sig-1');
    const audits = await storage.auditLogs.list({ resourceType: 'webhook_event' });
    expect(audits[0]?.after).toEqual({ id: 'authoritative' });
  });

  it('does not re-verify replay when the provider no longer declares webhooks', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('webhooks');
    provider.verifyError = new Error('verifyWebhook should not be called');
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_stored_only',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{"signed":true}',
      signature: 'sig-1',
      data: { id: 'stored' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_stored_only',
      receivedAt: clock.now(),
    });

    await payable.replayWebhook(event.id, { allowed: true, actorId: 'admin-1' });

    expect(provider.lastVerifyInput).toBeUndefined();
    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processed');
    const audits = await storage.auditLogs.list({ resourceType: 'webhook_event' });
    expect(audits[0]?.after).toEqual({ id: 'stored' });
  });

  it('fails replay when the stored signature no longer verifies', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    provider.verifyError = new Error('bad signature');
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_reverify_bad',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{"signed":true}',
      signature: 'sig-bad',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_reverify_bad',
      receivedAt: clock.now(),
    });

    await expect(
      payable.replayWebhook(event.id, { allowed: true, actorId: 'admin-1' }),
    ).rejects.toThrow('bad signature');
    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('failed');
  });

  it('refuses to replay a legacy event with no stored signature to re-verify', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_legacy',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      data: { id: 'in_1' },
      headers: {},
      status: 'failed',
      correlationId: 'corr_legacy',
      receivedAt: clock.now(),
    });

    await expect(
      payable.replayWebhook(event.id, { allowed: true, actorId: 'admin-1' }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_REPLAY_UNVERIFIABLE' });
    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('failed');
  });

  it('does not replay an event another worker is actively processing', async () => {
    const provider = new FakeProvider();
    provider.verifyResult = verifyResult;
    const payable = createPayable({ providers: { stripe: provider }, storage, clock });

    const event = await storage.webhookEvents.create({
      tenantId: null,
      provider: 'stripe',
      providerEventId: 'evt_live_processing',
      type: 'invoice.paid',
      normalizedType: 'invoice.paid',
      payload: '{}',
      signature: 'sig',
      data: { id: 'in_1' },
      headers: {},
      status: 'pending',
      correlationId: 'corr_live',
      receivedAt: clock.now(),
    });
    expect(await storage.webhookEvents.claim(event.id)).toEqual(expect.any(String));
    const auditBefore = (await storage.auditLogs.list({ resourceType: 'webhook_event' })).length;

    await payable.replayWebhook(event.id, { allowed: true, actorType: 'user', actorId: 'admin-1' });

    expect((await storage.webhookEvents.findById(event.id))?.status).toBe('processing');
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toHaveLength(
      auditBefore,
    );
  });
});
