import {
  callbackPayloadToFormFields,
  createStatelessSisp,
  type StatelessSispConfig,
} from '@akira-io/sisp';
import type { Knex } from 'knex';
import { beforeEach, describe, expect, it } from 'vitest';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import { Money } from '../src/domain/value-objects/money';
import { payableSispCorrelationStore } from '../src/infrastructure/providers/sisp/sisp-correlation-store';
import { sispMerchantReference } from '../src/infrastructure/providers/sisp/sisp-merchant-reference';
import { SispProvider } from '../src/infrastructure/providers/sisp/sisp-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const CREDENTIALS = { posId: '90000045', posAutCode: 'aut-code', sandbox: true } as const;
const ctx: OperationContext = { correlationId: 'corr-1', idempotencyKey: 'idem-1' };
const AMOUNT = Money.of(150000, 'CVE');

const sandbox = createStatelessSisp(CREDENTIALS as StatelessSispConfig);

interface Correlation {
  merchant_ref: string;
  merchant_session: string;
  amount: string;
}

let db: Knex;
let provider: SispProvider;

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  const storage = new KnexStorageDriver(db, new FakeClock());
  provider = new SispProvider({
    ...CREDENTIALS,
    correlation: payableSispCorrelationStore(storage),
  });
});

async function startCheckout(): Promise<Correlation> {
  await provider.createCheckoutSession(
    {
      providerCustomerId: 'local-1',
      mode: 'payment',
      lineItems: [],
      successUrl: 'https://shop.cv/ok',
      cancelUrl: 'https://shop.cv/cancel',
      amount: AMOUNT,
    },
    ctx,
  );
  const row = (await db('payable_redirect_correlations').first()) as Correlation | undefined;
  if (!row) {
    throw new Error('the checkout did not record a correlation');
  }
  return row;
}

function callbackBody(
  correlation: Pick<Correlation, 'merchant_ref' | 'merchant_session'>,
  options: { amount?: number; status?: 'success' | 'failed' } = {},
): Record<string, unknown> {
  const payload = sandbox.generateSandboxPayload(
    {
      amount: options.amount ?? 1500,
      merchantRef: correlation.merchant_ref,
      merchantSession: correlation.merchant_session,
    },
    options.status ?? 'success',
  );
  return callbackPayloadToFormFields(payload);
}

describe('SISP stateless callbacks', () => {
  it('records the expected payment when the checkout starts', async () => {
    const correlation = await startCheckout();
    expect(correlation.amount).toBe('1500');
    expect(correlation.merchant_session).not.toBe('');
  });

  it('accepts an authentic approved callback', async () => {
    const correlation = await startCheckout();
    const result = await provider.handleRedirectCallback(callbackBody(correlation));
    expect(result).toEqual({ providerPaymentId: correlation.merchant_ref, status: 'succeeded' });
  });

  it('accepts an authentic declined callback and reports the gateway verdict', async () => {
    const correlation = await startCheckout();
    const result = await provider.handleRedirectCallback(
      callbackBody(correlation, { status: 'failed' }),
    );
    expect(result).toEqual({ providerPaymentId: correlation.merchant_ref, status: 'failed' });
  });

  it('rejects a callback whose fingerprint does not hold', async () => {
    const correlation = await startCheckout();
    const body = { ...callbackBody(correlation), resultFingerPrint: 'tampered' };
    await expect(provider.handleRedirectCallback(body)).rejects.toMatchObject({
      code: 'PROVIDER_SISP_INVALID_CALLBACK',
      context: { reason: 'invalid_callback_fingerprint' },
    });
  });

  it('rejects a replayed callback', async () => {
    const correlation = await startCheckout();
    const body = callbackBody(correlation);
    await provider.handleRedirectCallback(body);
    await expect(provider.handleRedirectCallback(body)).rejects.toMatchObject({
      code: 'PROVIDER_SISP_INVALID_CALLBACK',
      context: { reason: 'callback_replayed' },
    });
  });

  it('rejects an authentic callback that carries a different amount', async () => {
    const correlation = await startCheckout();
    await expect(
      provider.handleRedirectCallback(callbackBody(correlation, { amount: 9999 })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_SISP_INVALID_CALLBACK',
      context: { reason: 'callback_details_mismatch' },
    });
  });

  it('rejects a callback for a payment that was never started', async () => {
    await startCheckout();
    const body = callbackBody({ merchant_ref: 'R-unknown', merchant_session: 'S-unknown' });
    await expect(provider.handleRedirectCallback(body)).rejects.toMatchObject({
      code: 'PROVIDER_SISP_INVALID_CALLBACK',
      context: { reason: 'unknown_transaction' },
    });
  });

  it('refuses a second checkout that reuses the merchant reference', async () => {
    await startCheckout();

    await expect(
      provider.createCheckoutSession(
        {
          providerCustomerId: 'local-1',
          mode: 'payment',
          lineItems: [],
          successUrl: 'https://shop.cv/ok',
          cancelUrl: 'https://shop.cv/cancel',
          amount: AMOUNT,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_SISP_DUPLICATE_MERCHANT_REFERENCE' });
  });

  it('sends the merchant reference payable derived rather than letting node-sisp reject it', async () => {
    const correlation = await startCheckout();
    expect(correlation.merchant_ref).toBe(sispMerchantReference('idem-1'));
  });

  it('refuses to handle a callback when no correlation store is configured', async () => {
    const bare = new SispProvider(CREDENTIALS as StatelessSispConfig);
    await expect(
      bare.handleRedirectCallback({ merchantRespMerchantRef: 'R-1' }),
    ).rejects.toMatchObject({ code: 'PROVIDER_SISP_CORRELATION_REQUIRED' });
  });

  it('records the tenant the store was built for', async () => {
    const db2 = createTestDb();
    await migrate(db2);
    const storage = new KnexStorageDriver(db2, new FakeClock());
    const tenantProvider = new SispProvider({
      ...CREDENTIALS,
      correlation: payableSispCorrelationStore(storage, { tenantId: 'tenant-a' }),
    });
    await tenantProvider.createCheckoutSession(
      {
        providerCustomerId: 'local-1',
        mode: 'payment',
        lineItems: [],
        successUrl: 'https://shop.cv/ok',
        cancelUrl: 'https://shop.cv/cancel',
        amount: AMOUNT,
      },
      ctx,
    );
    const row = (await db2('payable_redirect_correlations').first()) as { tenant_id: string };
    expect(row.tenant_id).toBe('tenant-a');
    await db2.destroy();
  });

  it('leaves the processed outcome on the correlation row', async () => {
    const correlation = await startCheckout();
    await provider.handleRedirectCallback(callbackBody(correlation));
    const row = (await db('payable_redirect_correlations').first()) as Record<string, unknown>;
    expect(row.outcome_status).toBe('completed');
    expect(row.processed_at).not.toBeNull();
  });
});
