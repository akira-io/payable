import { describe, expect, it } from 'vitest';
import { DownloadInvoicePdfAction } from '../src/application/actions/invoices/download-invoice-pdf.action';
import type { BillingDependencies } from '../src/application/builders/billing-dependencies';
import { assertProviderCapability } from '../src/application/services/provider-capabilities/assert-provider-capability';
import { ProviderCapabilityNotSupportedError } from '../src/domain/errors/provider-capability-not-supported.error';
import { PaddleProvider } from '../src/infrastructure/providers/paddle/paddle-provider';
import { FakeClock } from '../src/support/clock/fake-clock';
import { FakeProvider } from './support/fake-provider';

const paddle = () => new PaddleProvider({ apiKey: 'k', webhookSecret: 'w' });

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
});
