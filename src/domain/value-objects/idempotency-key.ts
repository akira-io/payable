import type { CurrencyCode } from './currency';

export interface BillableKeyParts {
  provider: string;
  billableType: string;
  billableId: string;
}

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
  reference?: string;
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

function segment(value: string | number): string {
  return encodeURIComponent(String(value));
}

function amountSegment(value: number): string {
  if (!Number.isFinite(value)) {
    throw new TypeError(`Idempotency key amount must be finite, got ${value}`);
  }
  return segment(value);
}

function currencySegment(value: CurrencyCode): string {
  return segment(value.toUpperCase());
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
    const base = `checkout:${segment(parts.provider)}:${segment(parts.billableType)}:${segment(parts.billableId)}:${segment(parts.price)}:${segment(parts.subscriptionName)}`;
    return IdempotencyKey.of(
      parts.reference === undefined ? base : `${base}:${segment(parts.reference)}`,
    );
  }

  static forCharge(parts: ChargeKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `charge:${segment(parts.provider)}:${segment(parts.billableType)}:${segment(parts.billableId)}:${segment(parts.reference)}:${amountSegment(parts.amount)}:${currencySegment(parts.currency)}`,
    );
  }

  static forSubscription(parts: SubscriptionKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `subscription:${segment(parts.provider)}:${segment(parts.billableType)}:${segment(parts.billableId)}:${segment(parts.subscriptionName)}:${segment(parts.price)}`,
    );
  }

  static forRefund(parts: RefundKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `refund:${segment(parts.provider)}:${segment(parts.paymentId)}:${amountSegment(parts.amount)}:${currencySegment(parts.currency)}`,
    );
  }

  static forWebhook(parts: WebhookKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `webhook:${segment(parts.provider)}:${segment(parts.providerEventId)}`,
    );
  }

  static forCustomer(parts: BillableKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `customer:${segment(parts.provider)}:${segment(parts.billableType)}:${segment(parts.billableId)}`,
    );
  }

  static forBillingPortal(parts: BillableKeyParts): IdempotencyKey {
    return IdempotencyKey.of(
      `portal:${segment(parts.provider)}:${segment(parts.billableType)}:${segment(parts.billableId)}`,
    );
  }

  toString(): string {
    return this.value;
  }

  equals(other: IdempotencyKey): boolean {
    return this.value === other.value;
  }
}
