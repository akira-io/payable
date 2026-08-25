export const SUBSCRIPTION_PRICE_MIGRATION_STATUSES = [
  'previewed',
  'scheduled',
  'executing',
  'pending_renewal',
  'applied',
  'failed',
  'reconciliation_required',
  'cancelled',
] as const;

export type SubscriptionPriceMigrationStatus =
  (typeof SUBSCRIPTION_PRICE_MIGRATION_STATUSES)[number];

export function isSubscriptionPriceMigrationStatus(
  value: string,
): value is SubscriptionPriceMigrationStatus {
  return (SUBSCRIPTION_PRICE_MIGRATION_STATUSES as readonly string[]).includes(value);
}
