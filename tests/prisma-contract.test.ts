import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NodeEncryptionDriver } from '../src/infrastructure/encryption/node-encryption-driver';
import type { PrismaClientLike } from '../src/infrastructure/storage/prisma';
import { PrismaStorageDriver } from '../src/infrastructure/storage/prisma';
import { FakeClock } from '../src/support/clock/fake-clock';
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
