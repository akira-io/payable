export interface PaddleMoney {
  amount: string;
  currencyCode: string;
}

export interface PaddleCustomer {
  id: string;
  email: string | null;
  name: string | null;
}

export interface PaddleProductEntity {
  id: string;
  name: string;
  status: string;
}

export interface PaddlePriceEntity {
  id: string;
  productId: string;
  unitPrice: PaddleMoney;
  billingCycle?: { interval: string; frequency: number } | null;
}

export interface PaddleTransaction {
  id: string;
  checkout?: { url: string | null } | null;
}

export interface PaddleSubscriptionEntity {
  id: string;
  status: string;
  currentBillingPeriod?: { endsAt: string | null } | null;
  items?: ReadonlyArray<{
    trialDates?: { endsAt?: string | null } | null;
    trial_dates?: { ends_at?: string | null } | null;
  }> | null;
  trialEndsAt?: string | null;
}

export interface PaddleAdjustment {
  id: string;
  status: string;
  totals?: { total: string; currencyCode: string } | null;
}

export interface PaddlePortalSession {
  urls: { general: { overview: string } };
}

export interface PaddleWebhookEvent {
  eventId: string;
  eventType: string;
  occurredAt?: string;
  data: Record<string, unknown>;
}

export interface PaddleClient {
  customers: {
    create(body: { email: string; name?: string }): Promise<PaddleCustomer>;
    update(id: string, body: { email?: string; name?: string }): Promise<PaddleCustomer>;
  };
  products: {
    create(body: {
      name: string;
      taxCategory: string;
      description?: string;
    }): Promise<PaddleProductEntity>;
    update(id: string, body: { name?: string; description?: string }): Promise<PaddleProductEntity>;
  };
  prices: {
    create(body: {
      productId: string;
      description: string;
      unitPrice: PaddleMoney;
      billingCycle?: { interval: string; frequency: number };
    }): Promise<PaddlePriceEntity>;
  };
  transactions: {
    create(body: {
      items: { priceId: string; quantity: number }[];
      customerId?: string;
    }): Promise<PaddleTransaction>;
  };
  subscriptions: {
    update(
      id: string,
      body: {
        items?: { priceId: string; quantity: number }[];
        prorationBillingMode?: string;
      },
    ): Promise<PaddleSubscriptionEntity>;
    cancel(id: string, body?: { effectiveFrom?: string }): Promise<PaddleSubscriptionEntity>;
    resume(id: string, body: { effectiveFrom: string }): Promise<PaddleSubscriptionEntity>;
  };
  adjustments: {
    create(body: {
      action: string;
      transactionId: string;
      reason: string;
      type?: string;
    }): Promise<PaddleAdjustment>;
  };
  customerPortalSessions: {
    create(customerId: string, subscriptionIds: string[]): Promise<PaddlePortalSession>;
  };
  webhooks: {
    unmarshal(body: string, secret: string, signature: string): Promise<PaddleWebhookEvent | null>;
  };
}
