export const REFUND_STATUSES = ['pending', 'succeeded', 'failed', 'canceled'] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export function isRefundStatus(value: string): value is RefundStatus {
  return (REFUND_STATUSES as readonly string[]).includes(value);
}

export function isSuccessfulRefund(status: RefundStatus): boolean {
  return status === 'succeeded';
}
