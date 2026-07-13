import { describe, expect, it } from 'vitest';
import { SyncCustomerWithProviderAction } from '../src/application/actions/customers/sync-customer-with-provider.action';
import { DownloadInvoicePdfAction } from '../src/application/actions/invoices/download-invoice-pdf.action';
import { ListInvoicesAction } from '../src/application/actions/invoices/list-invoices.action';
import { ChargeAction } from '../src/application/actions/payments/charge.action';
import { CreateSubscriptionAction } from '../src/application/actions/subscriptions/create-subscription.action';
import { ReceiveWebhookAction } from '../src/application/actions/webhooks/receive-webhook.action';
import type { BillingDependencies } from '../src/application/builders/billing-dependencies';
import type { WebhookDependencies } from '../src/application/builders/webhook-dependencies';
import { assertProviderCapability } from '../src/application/services/provider-capabilities/assert-provider-capability';
import {
  isDisputeCapable,
  isInvoiceCapable,
  isPaymentMethodCapable,
  type PaymentProvider,
} from '../src/domain/contracts/payment-provider.contract';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
import { Money } from '../src/domain/value-objects/money';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import {
  SispProvider,
  type SispProviderOptions,
} from '../src/infrastructure/providers/sisp/sisp-provider';
import { StripeProvider } from '../src/infrastructure/providers/stripe/stripe-provider';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';

const paddle = () => new PaddleProvider({ apiKey: 'k', webhookSecret: 'w' });
const stripe = () => new StripeProvider({ secretKey: 'sk_test', webhookSecret: 'wh_test' });
const sispOptions: SispProviderOptions = {
  posId: '90000045',
  posAutCode: 'aut-code',
  database: { client: 'better-sqlite3', connection: { filename: ':memory:' } },
};
const paddleDeps = () =>
  ({ provider: paddle(), providerName: 'paddle', clock: new FakeClock() }) as BillingDependencies;
const billable = { billableType: 'User', billableId: '1', email: 'user@example.com', name: 'User' };

describe('provider capability guard', () => {
  it('throws for a capability the provider does not support', () => {
    expect(() => assertProviderCapability(paddle(), 'invoicePdf')).toThrow(
      ProviderCapabilityNotSupportedError,
    );
  });

  it('passes for a supported capability', () => {
    expect(() => assertProviderCapability(new FakeProvider(), 'refunds')).not.toThrow();
  });

  it('blocks the action before it reaches the provider', async () => {
    const deps = {
      provider: paddle(),
      providerName: 'paddle',
      clock: new FakeClock(),
    } as BillingDependencies;
    await expect(new DownloadInvoicePdfAction(deps).handle('in_1')).rejects.toBeInstanceOf(
      ProviderCapabilityNotSupportedError,
    );
  });

  it('blocks charge before reaching a provider that cannot charge', async () => {
    await expect(
      new ChargeAction(paddleDeps()).handle({ billable, amount: Money.of(100, 'USD') }),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });

  it('blocks direct subscription creation for a provider that cannot create one', async () => {
    await expect(
      new CreateSubscriptionAction(paddleDeps()).handle({
        billable,
        name: 'Pro',
        priceId: 'pri_1',
      }),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });

  it('blocks direct subscription creation when the provider method exists but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('subscriptions');

    await expect(
      new CreateSubscriptionAction({
        provider,
        providerName: 'fake',
        clock: new FakeClock(),
      } as BillingDependencies).handle({
        billable,
        name: 'Pro',
        priceId: 'price_pro',
      }),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    expect(provider.createdSubscriptions).toBe(0);
  });

  it('blocks listing invoices for a provider that cannot list them', async () => {
    await expect(new ListInvoicesAction(paddleDeps()).handle(billable)).rejects.toBeInstanceOf(
      ProviderCapabilityNotSupportedError,
    );
  });

  it('treats a provider that only lists invoices as not invoice-capable', () => {
    const partial = { name: 'partial', listInvoices: async () => [] } as unknown as PaymentProvider;
    expect(isInvoiceCapable(partial)).toBe(false);
  });

  it('requires both payment method operations', () => {
    const partial = {
      name: 'partial',
      listPaymentMethods: async () => [],
    } as unknown as PaymentProvider;
    expect(isPaymentMethodCapable(partial)).toBe(false);

    const capable = {
      name: 'capable',
      listPaymentMethods: async () => [],
      deletePaymentMethod: async () => undefined,
    } as unknown as PaymentProvider;
    expect(isPaymentMethodCapable(capable)).toBe(true);
  });

  it('requires every dispute operation', () => {
    const partial = {
      name: 'partial',
      listDisputes: async () => [],
      retrieveDispute: async () => ({}),
    } as unknown as PaymentProvider;
    expect(isDisputeCapable(partial)).toBe(false);

    const capable = {
      ...partial,
      acceptDispute: async () => undefined,
    } as unknown as PaymentProvider;
    expect(isDisputeCapable(capable)).toBe(true);
  });

  it('declares charge and webhook capabilities for built-in providers that support them', () => {
    expect(stripe().capabilities().has('charges')).toBe(true);
    expect(stripe().capabilities().has('webhooks')).toBe(true);
    expect(paddle().capabilities().has('charges')).toBe(false);
    expect(paddle().capabilities().has('webhooks')).toBe(true);
    expect(new SispProvider(sispOptions).capabilities().has('webhooks')).toBe(false);
  });

  it('blocks charge when the provider method exists but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('charges');

    await expect(
      new ChargeAction({ provider, providerName: 'fake', clock: new FakeClock() }).handle({
        billable,
        amount: Money.of(100, 'USD'),
      }),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    expect(provider.chargeCalls).toBe(0);
  });

  it('blocks webhook receipt when the provider method exists but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('webhooks');
    provider.verifyError = new Error('verifyWebhook should not be called');

    await expect(
      new ReceiveWebhookAction({
        provider,
        providerName: 'fake',
      } as unknown as WebhookDependencies).handle({ payload: '{}', signature: 'sig' }),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    expect(provider.lastVerifyInput).toBeUndefined();
  });

  it('blocks customer sync when the provider methods exist but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('customers');

    await expect(
      new SyncCustomerWithProviderAction({
        provider,
        providerName: 'fake',
        clock: new FakeClock(),
      } as BillingDependencies).handle(billable),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
    expect(provider.createCustomerCalls).toBe(0);
  });

  it('blocks invoice listing when the provider methods exist but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('invoicePdf');

    await expect(
      new ListInvoicesAction({
        provider,
        providerName: 'fake',
        clock: new FakeClock(),
      } as BillingDependencies).handle(billable),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });

  it('blocks invoice PDF download when the provider methods exist but the capability is not declared', async () => {
    const provider = new FakeProvider();
    provider.supportedCapabilities.delete('invoicePdf');

    await expect(
      new DownloadInvoicePdfAction({
        provider,
        providerName: 'fake',
        clock: new FakeClock(),
      } as BillingDependencies).handle('in_fake'),
    ).rejects.toBeInstanceOf(ProviderCapabilityNotSupportedError);
  });
});
