import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type {
  PaymentProvider,
  RedirectCallbackCapable,
  RedirectCallbackContext,
  RedirectCallbackResult,
} from '../src/domain/contracts/payment-provider.contract';
import type { ProviderCapabilities } from '../src/domain/dtos/capabilities.dto';
import type {
  CheckoutSessionDTO,
  CreateCheckoutSessionInput,
} from '../src/domain/dtos/checkout.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { RefundInput, RefundResultDTO } from '../src/domain/dtos/refund.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('reconcile redirect payment failure', () => {
  it('moves a pending payment to failed when the callback carries the checkout session', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { unsettled: new UnsettledAttemptProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(70000, 'EUR'))
      .create();

    const result = await payable.receiveRedirectCallback({
      provider: 'unsettled',
      checkoutSessionId: session.id,
      payload: { code: 'transaction_declined', message: 'declined', data: { status: 402 } },
    });

    expect(result).toMatchObject({ status: 'failed', paymentUpdated: true });
    const [payment] = await payable.customer(billable).payments();
    expect(payment).toMatchObject({ providerPaymentId: 'booking-44', status: 'failed' });
    const logs = await payable
      .auditLogs()
      .run({ resourceType: 'payment', resourceId: payment?.id });
    expect(logs[0]).toMatchObject({
      action: 'payment.reconciled',
      after: { status: 'failed' },
    });
    await db.destroy();
  });

  it('lets a later authorization advance a payment the callback marked failed', async () => {
    const db = createTestDb();
    await migrate(db);
    const provider = new UnsettledAttemptProvider();
    const payable = createPayable({
      providers: { unsettled: provider },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(70000, 'EUR'))
      .create();
    await payable.receiveRedirectCallback({
      provider: 'unsettled',
      checkoutSessionId: session.id,
      payload: { code: 'transaction_declined', message: 'declined', data: { status: 402 } },
    });

    provider.retryStatus = 'authorized';
    const retry = await payable.receiveRedirectCallback({
      provider: 'unsettled',
      checkoutSessionId: session.id,
      payload: { code: 'transaction_declined', message: 'declined', data: { status: 402 } },
    });

    expect(retry.paymentUpdated).toBe(true);
    const [payment] = await payable.customer(billable).payments();
    expect(payment?.status).toBe('authorized');
    await db.destroy();
  });

  it('is idempotent across duplicate failure callbacks', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { unsettled: new UnsettledAttemptProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    const session = await payable
      .customer(billable)
      .redirectCheckout(Money.of(70000, 'EUR'))
      .create();
    const callback = {
      provider: 'unsettled',
      checkoutSessionId: session.id,
      payload: { code: 'transaction_declined', message: 'declined', data: { status: 402 } },
    };

    expect((await payable.receiveRedirectCallback(callback)).paymentUpdated).toBe(true);
    expect((await payable.receiveRedirectCallback(callback)).paymentUpdated).toBe(false);

    const [payment] = await payable.customer(billable).payments();
    const logs = await payable
      .auditLogs()
      .run({ resourceType: 'payment', resourceId: payment?.id });
    expect(logs.filter((log) => log.action === 'payment.reconciled')).toHaveLength(1);
    await db.destroy();
  });

  it('rejects the same failure payload when no checkout session accompanies it', async () => {
    const db = createTestDb();
    await migrate(db);
    const payable = createPayable({
      providers: { unsettled: new UnsettledAttemptProvider() },
      storage: new KnexStorageDriver(db, new FakeClock()),
    });
    await payable.customer(billable).redirectCheckout(Money.of(70000, 'EUR')).create();

    await expect(
      payable.receiveRedirectCallback({
        provider: 'unsettled',
        payload: { code: 'transaction_declined', message: 'declined', data: { status: 402 } },
      }),
    ).rejects.toMatchObject({ code: 'REDIRECT_CALLBACK_INVALID' });

    const [payment] = await payable.customer(billable).payments();
    expect(payment?.status).toBe('pending');
    await db.destroy();
  });
});

class UnsettledAttemptProvider implements PaymentProvider, RedirectCallbackCapable {
  readonly name = 'unsettled';
  retryStatus: 'failed' | 'authorized' = 'failed';

  capabilities(): ProviderCapabilities {
    return new Set(['checkout']);
  }

  createCheckoutSession(
    _input: CreateCheckoutSessionInput,
    _ctx: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    return Promise.resolve({ id: 'booking-44', url: 'https://provider.test/checkout' });
  }

  refund(_input: RefundInput, _ctx: OperationContext): Promise<RefundResultDTO> {
    throw new Error('not used');
  }

  verifyCallback(_payload: Record<string, unknown>, context?: RedirectCallbackContext): boolean {
    return context?.checkoutSessionId !== undefined;
  }

  handleRedirectCallback(
    _payload: Record<string, unknown>,
    context?: RedirectCallbackContext,
  ): Promise<RedirectCallbackResult> {
    const checkoutSessionId = context?.checkoutSessionId;
    if (checkoutSessionId === undefined) throw new Error('missing checkout session');
    return Promise.resolve({
      providerPaymentId: checkoutSessionId,
      checkoutSessionId,
      status: this.retryStatus,
    });
  }
}
