export interface RedirectCorrelationKey {
  readonly provider: string;
  readonly merchantRef: string;
  readonly merchantSession: string;
}

export interface ExpectedRedirectPayment {
  readonly amount: string;
  readonly currency: string | null;
  readonly transactionCode: string | null;
}

export interface RedirectCorrelation extends RedirectCorrelationKey, ExpectedRedirectPayment {
  readonly tenantId: string | null;
  readonly recordedAt: Date;
  readonly claimedAt: Date | null;
  readonly processedAt: Date | null;
  readonly outcomeVerified: boolean | null;
  readonly outcomeStatus: string | null;
  readonly outcomeReason: string | null;
}

export interface NewRedirectCorrelation extends RedirectCorrelationKey, ExpectedRedirectPayment {
  readonly tenantId: string | null;
  readonly recordedAt: Date;
}

export type RedirectCorrelationClaim =
  | { readonly status: 'claimed'; readonly expected: ExpectedRedirectPayment }
  | { readonly status: 'missing' }
  | { readonly status: 'already_claimed' };

export interface RedirectCorrelationOutcome {
  readonly verified: boolean;
  readonly status: string;
  readonly reason: string | null;
  readonly processedAt: Date;
}

export interface OrphanedRedirectCorrelationQuery {
  readonly provider: string;
  readonly tenantId: string | null;
  readonly claimedBefore: Date;
  readonly limit: number;
}

export interface RedirectCorrelationRepository {
  record(input: NewRedirectCorrelation): Promise<void>;
  findSessionsByReference(provider: string, merchantRef: string): Promise<string[]>;
  claim(key: RedirectCorrelationKey, claimedAt: Date): Promise<RedirectCorrelationClaim>;
  markProcessed(key: RedirectCorrelationKey, outcome: RedirectCorrelationOutcome): Promise<void>;
  findOrphanedClaims(query: OrphanedRedirectCorrelationQuery): Promise<RedirectCorrelation[]>;
}
