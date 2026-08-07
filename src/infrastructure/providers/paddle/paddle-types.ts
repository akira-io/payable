export interface PaddleMoney {
  amount: string;
  currencyCode: string;
}

export interface PaddleCustomer {
  id: string;
  email: string | null;
  name: string | null;
}

export interface PaddleCollection<T> {
  hasMore: boolean;
  next(): Promise<T[]>;
}

export interface PaddleProductEntity {
  id: string;
  name: string;
  status: string;
  description?: unknown;
  customData?: Record<string, unknown> | null;
}

export interface PaddlePriceEntity {
  id: string;
  productId: string;
  unitPrice: PaddleMoney;
  description?: unknown;
  customData?: Record<string, unknown> | null;
  status: string;
  billingCycle?: { interval: unknown; frequency: unknown } | null;
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
    price?: { id?: string } | null;
    quantity?: number;
    trialDates?: { endsAt?: string | null } | null;
    trial_dates?: { ends_at?: string | null } | null;
  }> | null;
  trialEndsAt?: string | null;
}

export interface PaddleSubscriptionPreview {
  updateSummary?: {
    result: { action: 'charge' | 'credit'; amount: string; currencyCode: string };
  } | null;
  nextTransaction?: {
    details: { totals: { total: string; currencyCode: string } };
    billingPeriod: { startsAt: string };
  } | null;
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
      customData?: Record<string, string>;
    }): Promise<PaddleProductEntity>;
    get(id: string): Promise<PaddleProductEntity>;
    list(query?: {
      after?: string;
      perPage?: number;
      status?: string[];
    }): PaddleCollection<PaddleProductEntity>;
    update(
      id: string,
      body: {
        name?: string;
        description?: string;
        status?: string;
      },
    ): Promise<PaddleProductEntity>;
  };
  prices: {
    create(body: {
      productId: string;
      description: string;
      unitPrice: PaddleMoney;
      billingCycle?: { interval: string; frequency: number };
    }): Promise<PaddlePriceEntity>;
    get(id: string): Promise<PaddlePriceEntity>;
    list(query?: {
      after?: string;
      perPage?: number;
      productId?: string[];
      status?: string[];
    }): PaddleCollection<PaddlePriceEntity>;
    update(id: string, body: { status?: string }): Promise<PaddlePriceEntity>;
  };
  transactions: {
    create(body: {
      items: { priceId: string; quantity: number }[];
      customerId?: string;
    }): Promise<PaddleTransaction>;
  };
  subscriptions: {
    previewUpdate(
      id: string,
      body: {
        items: { priceId: string; quantity: number }[];
        prorationBillingMode: string;
        onPaymentFailure: string;
      },
    ): Promise<PaddleSubscriptionPreview>;
    update(
      id: string,
      body: {
        items?: { priceId: string; quantity: number }[];
        prorationBillingMode?: string;
        onPaymentFailure?: string;
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
