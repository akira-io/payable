export type IdentityCapability = 'verificationSessions';
export type IdentityCapabilityValue = IdentityCapability | (string & {});
export type IdentityCapabilities = ReadonlySet<IdentityCapabilityValue>;
export type IdentityCheck = 'document' | 'selfie' | 'id_number' | 'address' | 'phone';
export type IdentityVerificationStatus =
  | 'requires_input'
  | 'processing'
  | 'verified'
  | 'failed'
  | 'canceled'
  | 'redacted'
  | 'unknown';

export interface CreateIdentityVerificationInput {
  reference: string;
  checks: IdentityCheck[];
  returnUrl?: string;
}

export interface IdentityVerificationDTO {
  providerVerificationId: string;
  reference: string;
  checks: IdentityCheck[];
  status: IdentityVerificationStatus;
  clientSecret: string | null;
  verificationUrl: string | null;
  verifiedAt: Date | null;
  createdAt: Date | null;
}
