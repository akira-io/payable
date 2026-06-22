export const PAYMENT_STATUSES = [
  'pending',
  'processing',
  'succeeded',
  'failed',
  'canceled',
  'refunded',
  'partially_refunded',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: string): value is PaymentStatus {
  return (PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isSuccessfulPayment(status: PaymentStatus): boolean {
  return status === 'succeeded';
}
