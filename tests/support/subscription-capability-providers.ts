import type { PaymentProvider } from '../../src/domain/contracts/payment-provider.contract';
import type { ProviderCapabilities } from '../../src/domain/dtos/capabilities.dto';
import type { SubscriptionOperationCapabilities } from '../../src/domain/dtos/subscription-operation-capabilities.dto';

export class LegacySubscriptionProvider implements PaymentProvider {
  readonly name = 'legacy';

  capabilities(): ProviderCapabilities {
    return new Set(['checkout', 'subscriptions']);
  }

  async createCheckoutSession() {
    return { id: 'checkout', url: 'https://checkout.test' };
  }

  async refund(): Promise<never> {
    throw new Error('not supported');
  }

  async createSubscription() {
    return {
      providerSubscriptionId: 'subscription',
      status: 'active' as const,
      currentPeriodEnd: null,
      trialEndsAt: null,
    };
  }
}

export class DescribedProvider extends LegacySubscriptionProvider {
  constructor(private readonly descriptor: SubscriptionOperationCapabilities) {
    super();
  }

  subscriptionOperationCapabilities(): SubscriptionOperationCapabilities {
    return this.descriptor;
  }
}
