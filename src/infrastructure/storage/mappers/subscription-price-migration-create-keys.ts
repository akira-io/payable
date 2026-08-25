const CREATE_KEYS = [
  'tenantId',
  'subscriptionId',
  'primaryItemId',
  'sourcePriceId',
  'targetPriceId',
  'sourcePrice',
  'targetPrice',
  'currentItems',
  'proposedItems',
  'effectiveTiming',
  'effectiveAt',
  'prorationPolicy',
  'paymentFailurePolicy',
  'immediateAdjustment',
  'nextRenewal',
  'currentRenewalDate',
  'warnings',
  'providerLimitations',
  'previewToken',
  'requestHash',
  'calculatedAt',
  'expiresAt',
  'providerBindingId',
  'status',
  'attemptCount',
  'executionToken',
  'failureCode',
  'failureMessage',
  'scheduledAt',
  'executionStartedAt',
  'appliedAt',
  'failedAt',
  'reconciliationRequiredAt',
  'reconciliationOutcome',
  'reconciliationEvidenceReference',
  'reconciliationResolvedAt',
  'reconciliationObservationEvidenceReference',
  'reconciliationObservedAt',
  'cancelledAt',
].sort();

export function assertSubscriptionPriceMigrationCreateKeys(data: Record<string, unknown>): void {
  const actual = Object.keys(data).sort();
  if (
    actual.length !== CREATE_KEYS.length ||
    actual.some((key, index) => key !== CREATE_KEYS[index])
  ) {
    throw new Error('Invalid subscription price migration: input');
  }
}
