import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { PaymentProvider } from '../src/domain/contracts/payment-provider.contract';
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

const firstCustomer = {
  billableType: 'User',
  billableId: '1',
  email: 'first@example.com',
  name: 'First User',
};
const secondCustomer = {
  billableType: 'User',
  billableId: '2',
  email: 'second@example.com',
  name: 'Second User',
};

describe('redirect checkout session reuse', () => {
  it('allows concurrent identical retries to share one pending payment', async () => {
    const { db, payable } = await setup();
    const create = () =>
      payable
        .customer(firstCustomer)
        .redirectCheckout(Money.of(9999, 'EUR'))
        .create({ reference: 'same-order' });

    await expect(Promise.all([create(), create()])).resolves.toHaveLength(2);
    expect(await payable.customer(firstCustomer).payments()).toHaveLength(1);
    await db.destroy();
  });

  it('rejects concurrent conflicting payments for one booking', async () => {
    const { db, payable } = await setup();
    const results = await Promise.allSettled([
      payable
        .customer(firstCustomer)
        .redirectCheckout(Money.of(9999, 'EUR'))
        .create({ reference: 'deposit' }),
      payable
        .customer(firstCustomer)
        .redirectCheckout(Money.of(3000, 'EUR'))
        .create({ reference: 'balance' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection).toMatchObject({ reason: { code: 'CHECKOUT_PAYMENT_CONFLICT' } });
    expect(await payable.customer(firstCustomer).payments()).toHaveLength(1);
    await db.destroy();
  });

  it('rejects reuse by a different customer', async () => {
    const { db, payable } = await setup();
    const request = { reference: 'shared-reference' };
    await payable.customer(firstCustomer).redirectCheckout(Money.of(9999, 'EUR')).create(request);

    await expect(
      payable.customer(secondCustomer).redirectCheckout(Money.of(9999, 'EUR')).create(request),
    ).rejects.toMatchObject({ code: 'CHECKOUT_PAYMENT_CONFLICT' });
    await db.destroy();
  });
});

async function setup() {
  const db = createTestDb();
  await migrate(db);
  const payable = createPayable({
    providers: { reusable: new ReusableBookingProvider() },
    storage: new KnexStorageDriver(db, new FakeClock()),
  });
  return { db, payable };
}

class ReusableBookingProvider implements PaymentProvider {
  readonly name = 'reusable';

  capabilities(): ProviderCapabilities {
    return new Set(['checkout']);
  }

  createCheckoutSession(
    _input: CreateCheckoutSessionInput,
    _context: OperationContext,
  ): Promise<CheckoutSessionDTO> {
    return Promise.resolve({ id: 'booking-44', url: 'https://provider.test/checkout' });
  }

  refund(_input: RefundInput, _context: OperationContext): Promise<RefundResultDTO> {
    throw new Error('not used');
  }
}
