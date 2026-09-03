import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { PayableError } from '../src/domain/errors/payable-error';
import { Money } from '../src/domain/value-objects/money';
import { TrustMyTravelProvider } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-provider';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { KnexIdempotencyRepository } from '../src/infrastructure/storage/knex/repositories/knex-idempotency.repository';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('charge idempotency contract', () => {
  it('declares Trust My Travel charge mutations as non-native-idempotent', () => {
    const provider = new TrustMyTravelProvider({
      path: 'merchant',
      apiToken: 'api-token',
      channelId: 1,
      channelSecret: 'channel-secret',
      currency: 'EUR',
      environment: 'test',
    });
    expect(provider.chargeIdempotency).toBe('unsupported');
  });

  it('requires persistent idempotency for a non-native charge provider', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const provider = Object.assign(new FakeProvider(), {
      chargeIdempotency: 'unsupported' as const,
    });
    const payable = createPayable({
      providers: { tmt: provider },
      storage: new KnexStorageDriver(db, clock),
      clock,
    });

    await expect(
      payable.customer(billable).charge({ amount: Money.of(100, 'EUR'), reference: 'renewal-1' }),
    ).rejects.toMatchObject({ code: 'PAYMENT_IDEMPOTENCY_REQUIRED' });
    expect(provider.chargeCalls).toBe(0);
    await db.destroy();
  });

  it('single-flights concurrent non-native charge requests and never retries an uncertain failure', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const provider = Object.assign(new FakeProvider(), {
      chargeIdempotency: 'unsupported' as const,
    });
    const storage = new KnexStorageDriver(db, clock);
    const payable = createPayable({
      providers: { tmt: provider },
      storage,
      clock,
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });

    const [first, second] = await Promise.all([
      payable.customer(billable).charge({ amount: Money.of(100, 'USD'), reference: 'renewal-2' }),
      payable.customer(billable).charge({ amount: Money.of(100, 'USD'), reference: 'renewal-2' }),
    ]);
    expect(provider.chargeCalls).toBe(1);
    expect(second.id).toBe(first.id);

    provider.charge = async () => {
      provider.chargeCalls += 1;
      throw new PayableError('Outcome unknown', { code: 'PROVIDER_RESULT_UNKNOWN' });
    };
    const uncertain = () =>
      payable.customer(billable).charge({ amount: Money.of(200, 'USD'), reference: 'renewal-3' });
    await expect(uncertain()).rejects.toMatchObject({ code: 'PROVIDER_RESULT_UNKNOWN' });
    await expect(uncertain()).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    clock.advance(172_800_000);
    await expect(uncertain()).rejects.toMatchObject({
      code: 'IDEMPOTENCY_RECONCILIATION_REQUIRED',
    });
    expect(provider.chargeCalls).toBe(2);
    await db.destroy();
  });

  it('conflicts when a charge reference is reused with another retained-charge scope', async () => {
    const db = createTestDb();
    await migrate(db);
    const clock = new FakeClock();
    const provider = new FakeProvider();
    const payable = createPayable({
      providers: { fake: provider },
      storage: new KnexStorageDriver(db, clock),
      clock,
      idempotency: { store: new KnexIdempotencyRepository(db, clock) },
    });
    const charge = (paymentMethodId: string) =>
      payable.customer(billable).charge({
        amount: Money.of(100, 'USD'),
        reference: 'renewal-scope',
        paymentMethodId,
        offSession: true,
        providerData: { bookings: [{ id: 44, currencies: 'USD', total: 100 }] },
      });

    await charge('payment-method-1');
    await expect(charge('payment-method-2')).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
    });
    await db.destroy();
  });
});
