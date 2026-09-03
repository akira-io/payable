import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { Lock, LockDriver } from '../src/domain/contracts/lock-driver.contract';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type {
  AuthorizePaymentInput,
  CapturePaymentInput,
  CaptureResultDTO,
  VoidPaymentInput,
} from '../src/domain/dtos/payment-lifecycle.dto';
import { Money } from '../src/domain/value-objects/money';
import { MemoryLockDriver } from '../src/infrastructure/locks/memory-lock-driver';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

class LifecycleProvider extends FakeProvider {
  authorizeCalls = 0;
  captureCalls = 0;
  voidCalls = 0;

  constructor() {
    super();
    this.supportedCapabilities.add('authorize');
    this.supportedCapabilities.add('capture');
    this.supportedCapabilities.add('void');
  }

  async authorize(input: AuthorizePaymentInput, _ctx: OperationContext) {
    this.authorizeCalls += 1;
    return {
      providerPaymentId: `auth_${this.authorizeCalls}`,
      status: 'authorized' as const,
      amount: input.amount,
      expiresAt: new Date('2026-07-06T00:00:00.000Z'),
    };
  }

  async capture(input: CapturePaymentInput, _ctx: OperationContext): Promise<CaptureResultDTO> {
    this.captureCalls += 1;
    await Promise.resolve();
    return {
      providerPaymentId: input.providerPaymentId,
      status: 'succeeded' as const,
      amount: input.amount ?? Money.of(1000, 'USD'),
    };
  }

  async void(input: VoidPaymentInput, _ctx: OperationContext) {
    this.voidCalls += 1;
    return { providerPaymentId: input.providerPaymentId, status: 'canceled' as const };
  }
}

class TestDistributedLock implements LockDriver {
  readonly distributed = true;
  private readonly memory = new MemoryLockDriver();

  acquire(key: string, ttlMs: number): Promise<Lock | null> {
    return this.memory.acquire(key, ttlMs);
  }

  withLock<T>(key: string, ttlMs: number, work: () => Promise<T>): Promise<T> {
    return this.memory.withLock(key, ttlMs, work);
  }
}

const billable = { billableType: 'User', billableId: '1', email: 'user@example.test' };

describe('provider-neutral payment lifecycle actions', () => {
  it('persists authorization and replays a duplicate request', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    const payable = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    const first = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'order-1',
    });
    const restarted = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const replay = await restarted.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'order-1',
    });

    expect(first.payment.status).toBe('authorized');
    expect(first.payment.authorizationExpiresAt?.toISOString()).toBe('2026-07-06T00:00:00.000Z');
    expect(replay.payment.id).toBe(first.payment.id);
    expect(provider.authorizeCalls).toBe(1);
    const audit = await payable.auditLogs().run({ resourceIds: [first.payment.id] });
    expect(audit.map((entry) => entry.action)).toEqual(['payment.authorized']);
    await db.destroy();
  });

  it('isolates authorization idempotency by customer', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    provider.createCustomer = async (input) => ({
      id: `cus_${input.email}`,
      providerCustomerId: `cus_${input.email}`,
      email: input.email,
      name: input.name ?? null,
    });
    const payable = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    const first = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'shared-reference',
    });
    const second = await payable
      .customer({ ...billable, billableId: '2', email: 'other@example.test' }, 'test')
      .authorize({ amount: Money.of(1000, 'USD'), reference: 'shared-reference' });

    expect(second.payment.id).not.toBe(first.payment.id);
    expect(provider.authorizeCalls).toBe(2);
    await db.destroy();
  });

  it('does not retry an outcome-unknown capture', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    provider.capture = async (input) => {
      provider.captureCalls += 1;
      return {
        providerPaymentId: input.providerPaymentId,
        status: 'processing',
        amount: input.amount ?? Money.of(1000, 'USD'),
      };
    };
    const payable = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const { payment } = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'unknown-order',
    });
    const request = { reference: 'unknown-capture' };

    await expect(payable.payment(payment.id).capture(request)).rejects.toMatchObject({
      code: 'PAYMENT_OUTCOME_UNKNOWN',
    });
    await expect(payable.payment(payment.id).capture(request)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    await expect(
      payable.payment(payment.id).void({ reference: 'replacement-reference' }),
    ).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    expect(provider.captureCalls).toBe(1);
    expect((await storage.payments.findById(payment.id))?.status).toBe('authorized');
    await db.destroy();
  });

  it('rejects capture after the authorization window expires', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    const payable = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const { payment } = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'expiring-order',
    });
    clock.set(new Date('2026-07-06T00:00:00.000Z'));

    await expect(
      payable.payment(payment.id).capture({ reference: 'late-capture' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_AUTHORIZATION_EXPIRED' });
    expect(provider.captureCalls).toBe(0);
    expect((await storage.payments.findById(payment.id))?.status).toBe('failed');
    await db.destroy();
  });

  it('allows only one capture-or-void outcome', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    const payable = createPayable({
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const { payment } = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'order-race',
    });

    const outcomes = await Promise.allSettled([
      payable.payment(payment.id).capture({ reference: 'capture-race' }),
      payable.payment(payment.id).void({ reference: 'void-race' }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(provider.captureCalls + provider.voidCalls).toBe(1);
    await db.destroy();
  });

  it('replays completed capture and void after restart', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    const options = {
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    };
    const payable = createPayable(options);
    const captured = await payable.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'capture-restart',
    });
    await payable.payment(captured.payment.id).capture({ reference: 'capture-once' });
    const restarted = createPayable(options);
    const replay = await restarted
      .payment(captured.payment.id)
      .capture({ reference: 'capture-once' });
    expect(replay.status).toBe('succeeded');
    expect(provider.captureCalls).toBe(1);
    const voided = await restarted.customer(billable, 'test').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'void-restart',
    });
    await restarted.payment(voided.payment.id).void({ reference: 'void-once' });
    await createPayable(options).payment(voided.payment.id).void({ reference: 'void-once' });
    expect(provider.voidCalls).toBe(1);
    await db.destroy();
  });

  it('does not reveal a payment from another tenant', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock(new Date('2026-07-01T00:00:00.000Z'));
    const storage = new KnexStorageDriver(db, clock);
    const provider = new LifecycleProvider();
    const payable = createPayable({
      tenant: { enabled: true },
      providers: { test: provider },
      storage,
      clock,
      locks: new TestDistributedLock(),
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const { payment } = await payable.customer(billable, 'test', 'tenant-a').authorize({
      amount: Money.of(1000, 'USD'),
      reference: 'tenant-order',
    });
    await expect(
      payable.payment(payment.id, 'tenant-b').capture({ reference: 'cross-tenant' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
    expect(provider.captureCalls).toBe(0);
    await db.destroy();
  });
});
