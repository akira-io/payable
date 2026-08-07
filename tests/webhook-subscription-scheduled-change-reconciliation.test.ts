import type { Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPayable } from '../src/create-payable';
import { KnexStorageDriver } from '../src/infrastructure/storage/knex/knex-storage-driver';
import { migrate } from '../src/infrastructure/storage/knex/migrations/migrate';
import type { Payable } from '../src/payable';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';
import { createTestDb } from './support/knex';

let db: Knex;
let storage: KnexStorageDriver;
let provider: FakeProvider;
let payable: Payable;

const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

beforeEach(async () => {
  db = createTestDb();
  await migrate(db);
  const clock = new FakeClock(new Date('2026-06-22T00:00:00.000Z'));
  storage = new KnexStorageDriver(db, clock);
  provider = new FakeProvider();
  payable = createPayable({ providers: { stripe: provider }, storage, clock });
});

afterEach(async () => {
  await db.destroy();
});

async function seedSubscription() {
  return payable.customer(billable).newSubscription('default').price('price_pro').create();
}

function prepareWebhook(providerEventId: string) {
  provider.verifyResult = {
    providerEventId,
    type: 'subscription.updated',
    normalizedType: 'subscription.updated',
    data: {},
  };
}

describe('scheduled subscription change webhook reconciliation', () => {
  it('reconciles scheduled lifecycle and payment-collection metadata', async () => {
    await seedSubscription();
    prepareWebhook('evt_lifecycle_metadata');
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-07-22T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-08-22T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
      paymentCollectionPauseBehavior: 'keepAsDraft',
      paymentCollectionResumesAt: new Date('2026-07-01T00:00:00.000Z'),
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(await storage.subscriptions.findByProviderId('stripe', 'sub_fake')).toMatchObject({
      scheduledChangeAction: 'pause',
      scheduledChangeEffectiveAt: new Date('2026-07-22T00:00:00.000Z'),
      scheduledResumeAt: new Date('2026-08-22T00:00:00.000Z'),
      resumeBillingPolicy: 'continueExistingBillingPeriod',
      paymentCollectionPauseBehavior: 'keepAsDraft',
      paymentCollectionResumesAt: new Date('2026-07-01T00:00:00.000Z'),
    });
  });

  it('clears a resume policy when a scheduled pause is canceled externally', async () => {
    const subscription = await seedSubscription();
    await storage.subscriptions.update(
      subscription.id,
      {
        scheduledChangeAction: 'pause',
        scheduledChangeEffectiveAt: new Date('2026-07-22T00:00:00.000Z'),
        scheduledResumeAt: new Date('2026-08-22T00:00:00.000Z'),
        resumeBillingPolicy: 'continueExistingBillingPeriod',
      },
      null,
    );
    prepareWebhook('evt_scheduled_pause_canceled');
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(await storage.subscriptions.findByProviderId('stripe', 'sub_fake')).toMatchObject({
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
      resumeBillingPolicy: null,
    });
  });

  it('clears a resume policy when a scheduled resume completes', async () => {
    const subscription = await seedSubscription();
    await storage.subscriptions.update(
      subscription.id,
      {
        status: 'paused',
        scheduledChangeAction: 'resume',
        scheduledChangeEffectiveAt: new Date('2026-07-22T00:00:00.000Z'),
        resumeBillingPolicy: 'startNewBillingPeriod',
      },
      null,
    );
    prepareWebhook('evt_scheduled_resume_completed');
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'active',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(await storage.subscriptions.findByProviderId('stripe', 'sub_fake')).toMatchObject({
      status: 'active',
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      resumeBillingPolicy: null,
    });
  });

  it('preserves the resume policy for an indefinitely paused subscription', async () => {
    const subscription = await seedSubscription();
    await storage.subscriptions.update(
      subscription.id,
      { status: 'paused', resumeBillingPolicy: 'continueExistingBillingPeriod' },
      null,
    );
    prepareWebhook('evt_indefinitely_paused');
    provider.reconcileResult = {
      providerSubscriptionId: 'sub_fake',
      status: 'paused',
      currentPeriodEnd: null,
      trialEndsAt: null,
      scheduledChangeAction: null,
      scheduledChangeEffectiveAt: null,
      scheduledResumeAt: null,
    };

    await payable.receiveWebhook({ payload: '{}', signature: 'sig' });

    expect(await storage.subscriptions.findByProviderId('stripe', 'sub_fake')).toMatchObject({
      status: 'paused',
      resumeBillingPolicy: 'continueExistingBillingPeriod',
    });
  });
});
