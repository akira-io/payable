export interface PrismaRedirectCorrelationRow {
  provider: string;
  merchantRef: string;
  merchantSession: string;
  tenantId: string | null;
  amount: string;
  currency: string | null;
  transactionCode: string | null;
  recordedAt: Date;
  claimedAt: Date | null;
  processedAt: Date | null;
  outcomeVerified: boolean | null;
  outcomeStatus: string | null;
  outcomeReason: string | null;
}
