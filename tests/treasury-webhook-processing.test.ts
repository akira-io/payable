import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { QueueJob } from '../src/domain/contracts/queue-driver.contract';
import type {
  TreasuryProvider,
  TreasuryWebhookCapable,
} from '../src/domain/contracts/treasury-provider.contract';
import type { TreasuryCapabilities } from '../src/domain/dtos/treasury.dto';
import type { VerifiedTreasuryWebhook } from '../src/domain/dtos/treasury-webhook.dto';
import type { WebhookVerificationInput } from '../src/domain/dtos/webhook.dto';
import { InMemoryEventBus } from '../src/infrastructure/event-bus/in-memory-event-bus';
import { SyncQueueDriver } from '../src/infrastructure/queue/sync/sync-queue-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class FakeTreasuryWebhookProvider implements TreasuryProvider, TreasuryWebhookCapable {
  readonly name = 'fake-treasury';
  lastInput?: WebhookVerificationInput;
  result: VerifiedTreasuryWebhook = {
    providerEventId: 'treasury-event-1',
    type: 'TransactionCreated',
    normalizedType: 'treasury.transaction.created',
    occurredAt: new Date('2026-07-14T10:00:00.000Z'),
    data: { id: 'transaction-1' },
  };

  capabilities(): TreasuryCapabilities {
    return new Set(['webhooks']);
  }

  async verifyTreasuryWebhook(input: WebhookVerificationInput): Promise<VerifiedTreasuryWebhook> {
    this.lastInput = input;
    return this.result;
  }
}

class RecordingQueue extends SyncQueueDriver {
  readonly jobs: QueueJob[] = [];

  override async dispatch<T>(job: QueueJob<T>): Promise<void> {
    this.jobs.push(job as QueueJob);
    await super.dispatch(job);
  }
}

async function harness(options?: {
  queue?: SyncQueueDriver;
  events?: InMemoryEventBus;
  tenant?: { enabled: boolean; resolver?: { resolve(): string | Promise<string> } };
}) {
  const db = createTestDb();
  await migrate(db);
  const clock = new FakeClock();
  const storage = new KnexStorageDriver(db, clock);
  const provider = new FakeTreasuryWebhookProvider();
  const payable = createPayable({
    providers: { payment: new FakeProvider() },
    treasuryProviders: { bank: provider },
    storage,
    clock,
    queue: options?.queue,
    events: options?.events,
    tenant: options?.tenant,
  });
  return { db, storage, provider, payable, clock };
}

describe('Treasury webhook processing', () => {
  it('verifies, stores, processes, audits, emits, and deduplicates independently', async () => {
    const events = new InMemoryEventBus();
    const emitted: { name: string; occurredAt: Date }[] = [];
    events.listen('treasury.webhook.processed', (event) => {
      emitted.push({ name: event.name, occurredAt: event.occurredAt });
    });
    const { db, storage, provider, payable } = await harness({ events });

    const first = await payable.receiveTreasuryWebhook({
      provider: 'bank',
      payload: '{"event":"TransactionCreated"}',
      signature: 'signed',
      headers: { 'revolut-request-timestamp': '1' },
    });
    const second = await payable.receiveTreasuryWebhook({
      provider: 'bank',
      payload: '{"event":"TransactionCreated"}',
      signature: 'signed',
    });

    expect(provider.lastInput).toMatchObject({ signature: 'signed' });
    expect(first).toMatchObject({ duplicate: false, status: 'processed' });
    expect(second).toMatchObject({ duplicate: true, status: 'processed' });
    expect(
      await storage.webhookEvents.findByProviderEvent('bank', 'treasury-event-1'),
    ).toMatchObject({
      status: 'processed',
      normalizedType: 'treasury.transaction.created',
      occurredAt: new Date('2026-07-14T10:00:00.000Z'),
    });
    expect(await storage.auditLogs.list({ resourceType: 'webhook_event' })).toMatchObject([
      { action: 'treasury.webhook.TransactionCreated', actorId: 'bank' },
    ]);
    const [outbox] = await db('payable_outbox_events').select('event_type', 'payload');
    expect(outbox.event_type).toBe('treasury.transaction.created.v1');
    expect(JSON.parse(outbox.payload)).toMatchObject({
      providerEventId: 'treasury-event-1',
      occurredAt: '2026-07-14T10:00:00.000Z',
    });
    expect(emitted).toEqual([
      {
        name: 'treasury.webhook.processed',
        occurredAt: new Date('2026-07-14T10:00:00.000Z'),
      },
    ]);
    await db.destroy();
  });

  it('dispatches the dedicated Treasury queue job', async () => {
    const queue = new RecordingQueue();
    const { db, payable } = await harness({ queue });

    await payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' });

    expect(queue.jobs).toMatchObject([
      { name: 'payable.treasury-webhook.process', idempotencyKey: expect.any(String) },
    ]);
    await db.destroy();
  });

  it('stores unknown verified events without creating an outbox event', async () => {
    const { db, provider, payable } = await harness();
    provider.result = { ...provider.result, type: 'FutureEvent', normalizedType: null };

    await expect(
      payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' }),
    ).resolves.toMatchObject({ status: 'processed' });

    expect(await db('payable_outbox_events')).toHaveLength(0);
    expect(await db('payable_audit_logs').select('action')).toEqual([
      { action: 'treasury.webhook.FutureEvent' },
    ]);
    await db.destroy();
  });

  it('requires a tenant when tenancy is enabled', async () => {
    const { db, payable } = await harness({ tenant: { enabled: true } });

    await expect(
      payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' }),
    ).rejects.toMatchObject({ code: 'TENANT_REQUIRED' });
    await db.destroy();
  });

  it('uses the tenant resolver and keeps provider event identities tenant-scoped', async () => {
    const { db, storage, payable } = await harness({
      tenant: { enabled: true, resolver: { resolve: () => 'tenant-a' } },
    });

    await payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' });

    expect(
      await storage.webhookEvents.findByProviderEvent('bank', 'treasury-event-1', 'tenant-a'),
    ).toMatchObject({ tenantId: 'tenant-a', status: 'processed' });
    await db.destroy();
  });

  it('marks failed processing and retries the same stored event on redelivery', async () => {
    const { db, storage, provider, payable } = await harness();
    const transaction = storage.transaction.bind(storage);
    let fail = true;
    storage.transaction = async (work) => {
      if (fail) {
        fail = false;
        throw new Error('temporary storage failure');
      }
      return transaction(work);
    };

    await expect(
      payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' }),
    ).rejects.toThrow('temporary storage failure');
    expect(
      await storage.webhookEvents.findByProviderEvent('bank', 'treasury-event-1'),
    ).toMatchObject({ status: 'failed' });

    provider.result = {
      ...provider.result,
      occurredAt: new Date('2026-07-14T12:00:00.000Z'),
    };
    await expect(
      payable.receiveTreasuryWebhook({ provider: 'bank', payload: '{}', signature: 'sig' }),
    ).resolves.toMatchObject({ duplicate: true, status: 'processed' });
    const [outbox] = await db('payable_outbox_events').select('payload');
    expect(JSON.parse(outbox.payload).occurredAt).toBe('2026-07-14T10:00:00.000Z');
    await db.destroy();
  });
});
