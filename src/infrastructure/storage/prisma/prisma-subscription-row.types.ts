export interface PrismaSubscriptionRow {
  id: string;
  tenantId: string | null;
  customerId: string;
  name: string;
  provider: string;
  providerSubscriptionId: string | null;
  status: string;
  priceId: string | null;
  quantity: number;
  trialEndsAt: Date | null;
  endsAt: Date | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  providerSyncedAt: Date | null;
  scheduledChangeAction: string | null;
  scheduledChangeEffectiveAt: Date | null;
  scheduledResumeAt: Date | null;
  resumeBillingPolicy: string | null;
  paymentCollectionPauseBehavior: string | null;
  paymentCollectionResumesAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
