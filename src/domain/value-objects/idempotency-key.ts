import type { CurrencyCode } from './currency';

export interface ChargeKeyParts {
  provider: string;
  billableType: string;
  billableId: string;
  reference: string;
  amount: number;
  currency: CurrencyCode;
}

export interface CheckoutKeyParts {
  provider: string;
  billableType: string;
  billableId: string;
  price: string;
  subscriptionName: string;
}

export interface SubscriptionKeyParts {
  provider: string;
  billableType: string;
  billableId: string;
  subscriptionName: string;
  price: string;
}

export interface RefundKeyParts {
  provider: string;
  paymentId: string;
  amount: number;
  currency: CurrencyCode;
}

export interface WebhookKeyParts {
  provider: string;
  providerEventId: string;
}

export class IdempotencyKey {
  private constructor(private readonly value: string) {}

  static of(value: string): IdempotencyKey {
    const normalized = value.trim();
    if (normalized.length === 0) {
      throw new TypeError('Idempotency key cannot be empty');
    }
    return new IdempotencyKey(normalized);
  }

  static forCheckout(parts: CheckoutKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `checkout:${parts.provider}:${parts.billableType}:${parts.billableId}:${parts.price}:${parts.subscriptionName}`,
    );
  }

  static forCharge(parts: ChargeKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `charge:${parts.provider}:${parts.billableType}:${parts.billableId}:${parts.reference}:${parts.amount}:${parts.currency}`,
    );
  }

  static forSubscription(parts: SubscriptionKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `subscription:${parts.provider}:${parts.billableType}:${parts.billableId}:${parts.subscriptionName}:${parts.price}`,
    );
  }

  static forRefund(parts: RefundKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `refund:${parts.provider}:${parts.paymentId}:${parts.amount}:${parts.currency}`,
    );
  }

  static forWebhook(parts: WebhookKeyParts): IdempotencyKey {
    return IdempotencyKey.of(`webhook:${parts.provider}:${parts.providerEventId}`);
  }

  toString(): string {
    return this.value;
  }

  equals(other: IdempotencyKey): boolean {
    return this.value === other.value;
  }
}
