export type TreasuryWebhookEventType =
  | 'treasury.account.created'
  | 'treasury.account.updated'
  | 'treasury.account.closed'
  | 'treasury.transaction.created'
  | 'treasury.transaction.updated'
  | 'treasury.transfer.created'
  | 'treasury.transfer.updated'
  | 'treasury.exchange.updated'
  | 'treasury.payout_link.created'
  | 'treasury.payout_link.updated';

export interface VerifiedTreasuryWebhook {
  providerEventId: string;
  type: string;
  normalizedType: TreasuryWebhookEventType | null;
  occurredAt: Date | null;
  data: Record<string, unknown>;
}
