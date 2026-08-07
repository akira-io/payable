import { isSubscriptionOperationCapabilitiesProvider } from '../../../domain/contracts/subscription-operation-capabilities-provider.contract';
import type {
  PreviewSubscriptionChangeInput,
  ProviderSubscriptionChangeInput,
  SubscriptionChangeItem,
  SubscriptionChangePreview,
} from '../../../domain/dtos/subscription-change.dto';
import { ProviderCapabilityNotSupportedError } from '../../../domain/errors/provider-capability-not-supported.error';
import { SubscriptionChangePreviewError } from '../../../domain/errors/subscription-change-preview.error';
import { CorrelationId } from '../../../domain/value-objects/correlation-id';
import { IdempotencyKey } from '../../../domain/value-objects/idempotency-key';
import type { Billable } from '../../builders/billable';
import type { BillingDependencies } from '../../builders/billing-dependencies';
import type { AuthorizationContext } from '../../policies/authorization-context';
import { CanUpdateSubscriptionPolicy } from '../../policies/can-update-subscription.policy';
import { assertSubscriptionChangePolicies } from '../../services/provider-capabilities/assert-subscription-change-policies';
import { SubscriptionAction } from './subscription-action';

const PREVIEW_TTL_MS = 15 * 60 * 1_000;

export class PreviewSubscriptionChangeAction extends SubscriptionAction {
  constructor(
    deps: BillingDependencies,
    private readonly policy = new CanUpdateSubscriptionPolicy(),
  ) {
    super(deps);
  }

  async handle(
    billable: Billable,
    name: string,
    input: PreviewSubscriptionChangeInput,
    authorization?: AuthorizationContext,
  ): Promise<SubscriptionChangePreview> {
    this.authorize(
      (context) => this.policy.authorize(context),
      authorization,
      'preview subscription change',
    );
    if (input.priceId === undefined && input.quantity === undefined) {
      throw new SubscriptionChangePreviewError(
        'Subscription change requires a price or quantity',
        'SUBSCRIPTION_CHANGE_EMPTY',
      );
    }
    const subscription = await this.resolve(billable, name);
    const operation = input.priceId === undefined ? 'changeQuantity' : 'changePrice';
    const provider = this.subscriptionChangeProvider(operation);
    if (!isSubscriptionOperationCapabilitiesProvider(provider)) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'subscriptions.change.preview');
    }
    const capabilities = provider.subscriptionOperationCapabilities()[operation];
    if (!capabilities.preview) {
      throw new ProviderCapabilityNotSupportedError(provider.name, 'subscriptions.change.preview');
    }
    assertSubscriptionChangePolicies(provider.name, capabilities, input);
    const selection = await this.selectItem(subscription, input.itemId);
    const providerInput = this.providerInput(
      subscription.providerSubscriptionId,
      subscription.currentPeriodEnd,
      selection,
      input,
    );
    const idempotency = this.changeIdempotency();
    const previews = this.previewStore();
    const tenantId = this.deps.tenantId ?? null;
    const key = IdempotencyKey.of(input.idempotencyKey).toString();
    return idempotency.execute({
      key,
      storageKey: `subscription-change-preview-request:${tenantId ?? ''}:${provider.name}:${subscription.id}:${key}`,
      scope: 'subscription-change-preview-request',
      operation: 'preview',
      request: { subscriptionId: subscription.id, ...input },
      resourceType: 'subscription',
      resourceId: subscription.id,
      tenantId,
      run: async () => {
        const providerPreview = await provider.previewSubscriptionChange(
          providerInput,
          this.context('change-preview', subscription.providerSubscriptionId, key),
        );
        const preview: SubscriptionChangePreview = {
          previewToken: `scp_${CorrelationId.generate().toString()}`,
          provider: provider.name,
          subscriptionId: subscription.id,
          currentItems: providerInput.currentItems,
          proposedItems: providerInput.proposedItems,
          effectiveTiming: input.effectiveTiming,
          prorationPolicy: input.prorationPolicy,
          paymentFailurePolicy: input.paymentFailurePolicy,
          calculatedAt: providerInput.calculatedAt,
          expiresAt: new Date(providerInput.calculatedAt.getTime() + PREVIEW_TTL_MS),
          currentRenewalDate: providerInput.renewalDate,
          ...providerPreview,
        };
        await previews.save(preview, tenantId);
        await this.auditPreview(subscription.id, preview, authorization);
        return preview;
      },
      revive: (response) =>
        previews.load((response as SubscriptionChangePreview).previewToken, tenantId),
    });
  }

  private providerInput(
    providerSubscriptionId: string,
    renewalDate: Date | null,
    selection: Awaited<ReturnType<SubscriptionAction['selectItem']>>,
    input: PreviewSubscriptionChangeInput,
  ): ProviderSubscriptionChangeInput {
    if (input.quantity !== undefined) {
      this.assertQuantity(input.quantity);
    }
    const currentItems: SubscriptionChangeItem[] = selection.items.map((subscriptionItem) => ({
      itemId: subscriptionItem.id,
      providerItemId: subscriptionItem.providerItemId,
      priceId: subscriptionItem.priceId,
      quantity: subscriptionItem.quantity,
    }));
    const proposedItems = currentItems.map((subscriptionItem) =>
      subscriptionItem.itemId === selection.selectedItem.id
        ? {
            ...subscriptionItem,
            priceId: input.priceId ?? subscriptionItem.priceId,
            quantity: input.quantity ?? subscriptionItem.quantity,
          }
        : subscriptionItem,
    );
    return {
      providerSubscriptionId,
      currentItems,
      proposedItems,
      effectiveTiming: input.effectiveTiming,
      prorationPolicy: input.prorationPolicy,
      paymentFailurePolicy: input.paymentFailurePolicy,
      calculatedAt: this.deps.clock.now(),
      renewalDate,
    };
  }

  private async auditPreview(
    subscriptionId: string,
    preview: SubscriptionChangePreview,
    authorization?: AuthorizationContext,
  ): Promise<void> {
    await this.storage().transaction((repositories) =>
      this.auditWith(repositories, {
        action: 'subscription.change_previewed',
        subscriptionId,
        before: { items: preview.currentItems },
        after: { items: preview.proposedItems, previewToken: preview.previewToken },
        authorization,
      }),
    );
  }

  private changeIdempotency() {
    if (!this.deps.subscriptionChangeIdempotency) {
      throw new SubscriptionChangePreviewError(
        'Subscription change previews require an idempotency store',
        'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED',
      );
    }
    return this.deps.subscriptionChangeIdempotency;
  }

  private previewStore() {
    if (!this.deps.subscriptionChangePreviews) {
      throw new SubscriptionChangePreviewError(
        'Subscription change previews require an idempotency store',
        'SUBSCRIPTION_CHANGE_PREVIEW_STORAGE_REQUIRED',
      );
    }
    return this.deps.subscriptionChangePreviews;
  }
}
