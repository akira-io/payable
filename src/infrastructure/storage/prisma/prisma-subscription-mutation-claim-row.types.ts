export interface PrismaSubscriptionMutationClaimRow {
  claimReference: string;
  tenantKey: string;
  subscriptionId: string;
  activeSubscriptionId: string | null;
  ownerToken: string;
  operation: string;
  correlationId: string;
  intent: string | null;
  status: string;
  resolutionOutcome: string | null;
  resolutionEvidenceReference: string | null;
  resolvedAt: Date | null;
  observationOutcome: string | null;
  observationEvidenceReference: string | null;
  observedAt: Date | null;
  claimedAt: Date;
}
