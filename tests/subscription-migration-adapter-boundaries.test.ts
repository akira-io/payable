import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createExpressPayableRoutes } from '../src/presentation/express/create-express-payable-routes';
import { PayableModule } from '../src/presentation/nest/payable.module';
import { createNestExpressApplication } from './support/nest-express-application';
import { migrationAdapterPayable } from './support/subscription-migration-adapter-payable';

const BASE = '/canonical/subscription-price-migrations';
const previewBody = {
  subscriptionId: 'subscription-1',
  targetPriceId: 'price-new',
  effectiveTiming: 'immediate',
  prorationPolicy: 'prorateImmediately',
  paymentFailurePolicy: 'preventChange',
};
const mutations = [
  { path: BASE, body: previewBody },
  { path: `${BASE}/migration-1/approve`, body: {} },
  { path: `${BASE}/migration-1/cancel`, body: {} },
  { path: `${BASE}/migration-1/retry`, body: {} },
];

describe('subscription migration adapter-owned mutation boundaries', () => {
  it.each([
    'express',
    'nest',
  ] as const)('%s rate-limits create, approve, cancel, and retry independently of host middleware', async (adapter) => {
    for (const mutation of mutations) {
      const app = await createApp(adapter, { bodyLimit: 64 * 1024, max: 1 });
      try {
        const first = await app.send(mutation.path, mutation.body, 'rate-key-1');
        const second = await app.send(mutation.path, mutation.body, 'rate-key-2');
        expect(first.status).toBe(200);
        expect(second).toMatchObject({
          status: 429,
          body: { error: 'RATE_LIMIT_EXCEEDED', message: 'Too many mutation requests' },
        });
      } finally {
        await app.close();
      }
    }
  });

  it.each([
    'express',
    'nest',
  ] as const)('%s rejects oversized create, approve, cancel, and retry bodies before mutation', async (adapter) => {
    for (const mutation of mutations) {
      const app = await createApp(adapter, { bodyLimit: 256, max: 100 });
      try {
        const response = await app.send(
          mutation.path,
          { ...mutation.body, padding: 'x'.repeat(512) },
          'body-key',
        );
        expect(response).toMatchObject({
          status: 413,
          body: {
            error: 'PAYLOAD_TOO_LARGE',
            message: 'Request body exceeds the configured size limit',
          },
        });
      } finally {
        await app.close();
      }
    }
  });

  it.each([
    'express',
    'nest',
  ] as const)('%s returns canonical timestamps and hides arbitrary action errors', async (adapter) => {
    const app = await createApp(adapter, { bodyLimit: 64 * 1024, max: 100 });
    try {
      const created = await app.send(BASE, previewBody, 'timestamp-key');
      expect(created.body).toMatchObject({
        calculatedAt: '2026-08-25T12:00:00.000Z',
        expiresAt: '2026-08-25T12:15:00.000Z',
      });

      const failed = await app.send(`${BASE}/unsafe-error/approve`, {}, 'unsafe-key');
      expect(failed).toMatchObject({
        status: 500,
        body: {
          error: 'SUBSCRIPTION_MIGRATION_OPERATION_FAILED',
          message: 'Subscription migration operation failed',
        },
      });
    } finally {
      await app.close();
    }
  });
});

interface BoundaryApp {
  send(path: string, body: object, key: string): Promise<request.Response>;
  close(): Promise<void>;
}

async function createApp(
  adapter: 'express' | 'nest',
  limits: { bodyLimit: number; max: number },
): Promise<BoundaryApp> {
  const options = {
    resolveTenant: () => 'tenant-a',
    resolveAuthorization: () => ({
      allowed: true,
      actorId: 'boundary-operator',
      tenantId: 'tenant-a',
    }),
    subscriptionPriceMigrationLimits: {
      bodyLimit: limits.bodyLimit,
      rateLimit: { max: limits.max, windowMs: 60_000 },
    },
  };
  if (adapter === 'express') {
    const expressApp = express();
    expressApp.use(
      '/payable',
      createExpressPayableRoutes(
        migrationAdapterPayable(),
        options as Parameters<typeof createExpressPayableRoutes>[1],
      ),
    );
    return {
      send: (path, body, key) =>
        request(expressApp).post(`/payable${path}`).set('Idempotency-Key', key).send(body),
      close: async () => {},
    };
  }

  const nestApp = await createNestExpressApplication(
    PayableModule.forRoot(
      migrationAdapterPayable(),
      options as Parameters<typeof PayableModule.forRoot>[1],
    ),
    { subscriptionPriceMigrationLimits: options.subscriptionPriceMigrationLimits },
  );
  return {
    send: (path, body, key) =>
      request(nestApp.getHttpServer()).post(path).set('Idempotency-Key', key).send(body),
    close: () => nestApp.close(),
  };
}
