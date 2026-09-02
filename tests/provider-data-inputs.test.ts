import { describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import type { ChargeInput, ChargeResultDTO } from '../src/domain/dtos/charge.dto';
import type { CreateCheckoutSessionInput } from '../src/domain/dtos/checkout.dto';
import type { OperationContext } from '../src/domain/dtos/common.dto';
import type { RefundInput } from '../src/domain/dtos/refund.dto';
import { Money } from '../src/domain/value-objects/money';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

describe('provider data inputs', () => {
  it('accepts provider-specific data without changing canonical fields', () => {
    const providerData = { bookingId: 44 };
    const checkout: CreateCheckoutSessionInput = {
      providerCustomerId: '',
      mode: 'payment',
      lineItems: [],
      successUrl: 'https://shop.test/success',
      cancelUrl: 'https://shop.test/cancel',
      amount: Money.of(9999, 'EUR'),
      providerData,
    };
    const charge: ChargeInput = {
      amount: Money.of(9999, 'EUR'),
      providerData,
    };
    const refund: RefundInput = {
      providerPaymentId: 'transaction-1',
      providerData,
    };

    expect(checkout.providerData).toBe(providerData);
    expect(charge.providerData).toBe(providerData);
    expect(refund.providerData).toBe(providerData);
  });

  it('forwards provider-specific data through a direct charge', async () => {
    class CapturingProvider extends FakeProvider {
      lastInput?: ChargeInput;

      override charge(input: ChargeInput, ctx: OperationContext): Promise<ChargeResultDTO> {
        this.lastInput = input;
        return super.charge(input, ctx);
      }
    }
    const db = createTestDb();
    await migrate(db);
    const provider = new CapturingProvider();
    const providerData = { orderType: 'travel' };
    const storage = new KnexStorageDriver(db, new FakeClock());
    const payable = createPayable({ providers: { stripe: provider }, storage });

    await payable
      .customer({
        billableType: 'User',
        billableId: '1',
        email: 'user@example.com',
        name: 'User',
      })
      .charge({ amount: Money.of(9999, 'EUR'), providerData });

    expect(provider.lastInput?.providerData).toBe(providerData);
    await db.destroy();
  });
});
