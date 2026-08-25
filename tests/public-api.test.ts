import { describe, expect, it } from 'vitest';
import type {
  AuthorizationConfig,
  AuthorizationContext,
  CreateCanonicalPriceInput,
  CreateCanonicalProductInput,
  CreateMarketplaceTransferReversalInput,
  CreatePaymentMethodSetupInput,
  ListSubscriptionPriceMigrationsInput,
  MarketplaceTransferReversalCapable,
  MarketplaceTransferReversalDTO,
  MarketplaceTransferSourceReference,
  PaymentMethodSetupCapable,
  PaymentMethodSetupDTO,
  PreviewPriceMigrationInput,
  ResolveSubscriptionPriceMigrationInput,
  SubscriptionPriceMigration,
  SubscriptionPriceMigrationErrorCode,
  SubscriptionPriceMigrationExecutionEvidenceBlob,
  SubscriptionPriceMigrationResource,
  SubscriptionPriceMigrationStatus,
  TaxCalculationDTO,
  TaxCalculationStatus,
  TaxProvider,
  TreasuryWebhookCapable,
  TreasuryWebhookEventType,
  VerifiedTreasuryWebhook,
} from '../src/index';
import * as payable from '../src/index';

describe('public API surface', () => {
  it('exports the core entry points explicitly', () => {
    expect(typeof payable.createPayable).toBe('function');
    expect(typeof payable.Payable).toBe('function');
    expect(typeof payable.Money).toBe('function');
    expect(typeof payable.IdempotencyKey).toBe('function');
    expect(typeof payable.StripeProvider).toBe('function');
    expect(typeof payable.StripeIssuingProvider).toBe('function');
    expect(typeof payable.StripeMarketplaceProvider).toBe('function');
    expect(typeof payable.StripeTaxProvider).toBe('function');
    expect(typeof payable.StripeTerminalProvider).toBe('function');
    expect(typeof payable.StripeIdentityProvider).toBe('function');
    expect(typeof payable.PaddleProvider).toBe('function');
    expect(typeof payable.RevolutProvider).toBe('function');
    expect(typeof payable.RevolutBusinessIssuingProvider).toBe('function');
    expect(typeof payable.RevolutTerminalProvider).toBe('function');
    expect(typeof payable.RevolutBusinessAccountingProvider).toBe('function');
    expect(typeof payable.KnexStorageDriver).toBe('function');
    expect(typeof payable.AuditResource).toBe('function');
    expect(typeof payable.CanonicalProductResource).toBe('function');
    expect(typeof payable.CanonicalPriceResource).toBe('function');
    expect(typeof payable.ProviderCatalogResource).toBe('function');
    expect(typeof payable.KnexAuditLogRepository).toBe('function');
    expect(typeof payable.CatalogPersistenceError).toBe('function');
    expect(typeof payable.ok).toBe('function');
    expect(typeof payable.isChargeCapable).toBe('function');
    expect(typeof payable.isDisputeCapable).toBe('function');
    expect(typeof payable.isPaymentMethodCapable).toBe('function');
    expect(typeof payable.isPaymentMethodSetupCapable).toBe('function');
    expect(typeof payable.isPayoutCapable).toBe('function');
    expect(typeof payable.isProviderWebhookEndpointManagementCapable).toBe('function');
    expect(typeof payable.isPaymentWebhookCapable).toBe('function');
    expect(typeof payable.isTreasuryWebhookCapable).toBe('function');
    expect(typeof payable.isTaxCalculationCapable).toBe('function');
    expect(typeof payable.isTaxTransactionCapable).toBe('function');
    expect(typeof payable.TaxProviderRegistry).toBe('function');
    expect(typeof payable.TaxProviderNotFoundError).toBe('function');
    expect(typeof payable.isIssuingCardholderCapable).toBe('function');
    expect(typeof payable.isIssuingCardCapable).toBe('function');
    expect(typeof payable.isIssuingAuthorizationCapable).toBe('function');
    expect(typeof payable.isIssuingTransactionCapable).toBe('function');
    expect(typeof payable.IssuingProviderRegistry).toBe('function');
    expect(typeof payable.IssuingProviderNotFoundError).toBe('function');
    expect(typeof payable.isMarketplaceAccountCapable).toBe('function');
    expect(typeof payable.isMarketplaceOnboardingCapable).toBe('function');
    expect(typeof payable.isMarketplaceTransferCapable).toBe('function');
    expect(typeof payable.isMarketplaceTransferReversalCapable).toBe('function');
    expect(typeof payable.isMarketplacePayoutCapable).toBe('function');
    expect(typeof payable.MarketplaceProviderRegistry).toBe('function');
    expect(typeof payable.MarketplaceProviderNotFoundError).toBe('function');
    expect(typeof payable.isAccountingCategoryCapable).toBe('function');
    expect(typeof payable.isAccountingTaxRateCapable).toBe('function');
    expect(typeof payable.isAccountingLabelCapable).toBe('function');
    expect(typeof payable.isAccountingExpenseCapable).toBe('function');
    expect(typeof payable.isAccountingExpenseReadCapable).toBe('function');
    expect(typeof payable.isAccountingLedgerCapable).toBe('function');
    expect(typeof payable.AccountingProviderRegistry).toBe('function');
    expect(typeof payable.AccountingProviderNotFoundError).toBe('function');
    expect(typeof payable.isIdentityVerificationCapable).toBe('function');
    expect(typeof payable.IdentityProviderRegistry).toBe('function');
    expect(typeof payable.IdentityProviderNotFoundError).toBe('function');
    expect(typeof payable.isTerminalDeviceCapable).toBe('function');
    expect(typeof payable.isTerminalPaymentCapable).toBe('function');
    expect(typeof payable.TerminalProviderRegistry).toBe('function');
    expect(typeof payable.TerminalProviderNotFoundError).toBe('function');
    expect(typeof payable.SubscriptionStateMachine).toBe('function');
    expect(typeof payable.PreviewSubscriptionChangeAction).toBe('function');
    expect(typeof payable.ApplySubscriptionChangeAction).toBe('function');
    expect(typeof payable.SubscriptionChangePreviewStore).toBe('function');
    expect(typeof payable.SubscriptionChangePreviewError).toBe('function');
    expect(typeof payable.isSubscriptionChangeCapable).toBe('function');
    expect(typeof payable.PauseSubscriptionAction).toBe('function');
    expect(typeof payable.ResumePausedSubscriptionAction).toBe('function');
    expect(typeof payable.PausePaymentCollectionAction).toBe('function');
    expect(typeof payable.ResumePaymentCollectionAction).toBe('function');
    expect(typeof payable.CancelScheduledSubscriptionChangeAction).toBe('function');
    expect(typeof payable.isSubscriptionPauseCapable).toBe('function');
    expect(typeof payable.isPausedSubscriptionResumeCapable).toBe('function');
    expect(typeof payable.isSubscriptionPaymentCollectionCapable).toBe('function');
    expect(typeof payable.isScheduledSubscriptionChangeCapable).toBe('function');
  });

  it('exports canonical catalog input types', () => {
    const product = {
      name: 'Pro',
    } satisfies CreateCanonicalProductInput;
    const price = {
      productId: 'product-1',
      unitAmount: payable.Money.of(2900, 'EUR'),
      type: 'recurring',
      interval: 'month',
    } satisfies CreateCanonicalPriceInput;

    expect(product.name).toBe('Pro');
    expect(price.productId).toBe('product-1');
  });

  it('exports the canonical migration resource, entity, status, and errors', () => {
    const preview = {
      subscriptionId: 'subscription-1',
      targetPriceId: 'price-2',
      timing: { effectiveTiming: 'immediate' },
      prorationPolicy: 'none',
      paymentFailurePolicy: 'preventChange',
      idempotencyKey: 'migration-preview-1',
    } satisfies PreviewPriceMigrationInput;
    const list = {
      limit: 25,
      subscriptionId: preview.subscriptionId,
    } satisfies ListSubscriptionPriceMigrationsInput;
    const resolution = {
      outcome: 'applied',
      evidenceReference: 'operator-case-1',
      idempotencyKey: 'migration-resolve-1',
    } satisfies ResolveSubscriptionPriceMigrationInput;
    const status = 'pending_renewal' satisfies SubscriptionPriceMigrationStatus;
    const code =
      'SUBSCRIPTION_MIGRATION_RECONCILIATION_REQUIRED' satisfies SubscriptionPriceMigrationErrorCode;
    const migration = { status } as SubscriptionPriceMigration;
    const resource = {} as SubscriptionPriceMigrationResource;
    const evidence: SubscriptionPriceMigrationExecutionEvidenceBlob =
      payable.rehydrateSubscriptionPriceMigrationExecutionEvidenceBlob(
        'payable:subscription-price-migration-evidence:v1:opaque-storage-value',
      );

    expect(list.limit).toBe(25);
    expect(migration.status).toBe('pending_renewal');
    expect(payable.SUBSCRIPTION_PRICE_MIGRATION_STATUSES).toContain(status);
    expect(payable.isSubscriptionPriceMigrationStatus(status)).toBe(true);
    expect(typeof payable.SubscriptionPriceMigrationError).toBe('function');
    expect(new payable.SubscriptionPriceMigrationError('reconcile', code).code).toBe(code);
    expect(typeof (payable as Record<string, unknown>).SubscriptionPriceMigrationResource).toBe(
      'undefined',
    );
    expect(typeof resource).toBe('object');
    expect(resolution.outcome).toBe('applied');
    expect(evidence).toContain('opaque-storage-value');
  });

  it('exports AuthorizationContext on the public surface', () => {
    const context: AuthorizationContext = { allowed: true, actorId: 'a', actorType: 'user' };
    expect(context.allowed).toBe(true);
  });

  it('exports AuthorizationConfig alongside the sibling config types', () => {
    const config: AuthorizationConfig = { enabled: true };
    expect(config.enabled).toBe(true);
  });

  it('exports the payment method setup contract types', () => {
    const input: CreatePaymentMethodSetupInput = {
      providerCustomerId: 'customer_1',
      usage: 'off_session',
    };
    const setup: PaymentMethodSetupDTO = {
      providerSetupId: 'setup_1',
      providerCustomerId: input.providerCustomerId,
      status: 'requires_action',
      usage: input.usage,
      clientSecret: null,
      checkoutUrl: null,
      providerPaymentMethodId: null,
      createdAt: null,
    };
    const capable = {} as PaymentMethodSetupCapable;

    expect(setup.providerCustomerId).toBe('customer_1');
    expect(typeof capable).toBe('object');
  });

  it('exports the marketplace transfer reversal contract types', () => {
    const source = {
      type: 'charge',
      providerChargeId: 'ch_1',
    } satisfies MarketplaceTransferSourceReference;
    const reversalInput = {
      providerTransferId: 'tr_1',
      amount: 400,
      reference: 'order-1-reversal',
    } satisfies CreateMarketplaceTransferReversalInput;
    const reversal = {
      providerReversalId: 'trr_1',
      providerTransferId: reversalInput.providerTransferId,
      amount: payable.Money.of(400, 'USD'),
      reference: reversalInput.reference,
      createdAt: null,
    } satisfies MarketplaceTransferReversalDTO;
    const reversalCapable = {} as MarketplaceTransferReversalCapable;

    expect(source.providerChargeId).toBe('ch_1');
    expect(reversal.amount.amount()).toBe(400);
    expect(typeof reversalCapable).toBe('object');
  });

  it('exports the Treasury webhook contract types', () => {
    const normalizedType: TreasuryWebhookEventType = 'treasury.transaction.updated';
    const webhook: VerifiedTreasuryWebhook = {
      providerEventId: 'event_1',
      type: 'TransactionStateChanged',
      normalizedType,
      occurredAt: null,
      data: {},
    };
    const capable = {} as TreasuryWebhookCapable;

    expect(webhook.normalizedType).toBe(normalizedType);
    expect(typeof capable).toBe('object');
  });

  it('exports the tax provider contract types', () => {
    const status: TaxCalculationStatus = 'complete';
    const calculation = {
      providerCalculationId: 'taxcalc_1',
      status,
      subtotal: payable.Money.of(1000, 'USD'),
      tax: payable.Money.of(100, 'USD'),
      total: payable.Money.of(1100, 'USD'),
      expiresAt: null,
    } satisfies TaxCalculationDTO;
    const provider = {} as TaxProvider;

    expect(calculation.status).toBe('complete');
    expect(typeof provider).toBe('object');
  });

  it('does not export the not-yet-implemented Redis drivers', () => {
    expect('RedisCacheDriver' in payable).toBe(false);
    expect('RedisLockDriver' in payable).toBe(false);
    expect(typeof payable.MemoryCacheDriver).toBe('function');
    expect(typeof payable.MemoryLockDriver).toBe('function');
  });

  it('exports the redaction helpers for custom adapters and loggers', () => {
    expect(typeof payable.redactHeaders).toBe('function');
    expect(typeof payable.redactContext).toBe('function');
    expect(payable.redactHeaders({ authorization: 'secret' }).authorization).toBeUndefined();
  });
});
