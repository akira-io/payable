import type { OperationContext } from '../dtos/common.dto';
import type {
  CreateIdentityVerificationInput,
  IdentityCapabilities,
  IdentityVerificationDTO,
} from '../dtos/identity.dto';

export interface IdentityProvider {
  readonly name: string;
  capabilities(): IdentityCapabilities;
}

export interface IdentityVerificationCapable {
  createIdentityVerification(
    input: CreateIdentityVerificationInput,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO>;
  retrieveIdentityVerification(providerVerificationId: string): Promise<IdentityVerificationDTO>;
  cancelIdentityVerification(
    providerVerificationId: string,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO>;
  redactIdentityVerification(
    providerVerificationId: string,
    ctx: OperationContext,
  ): Promise<IdentityVerificationDTO>;
}

export function isIdentityVerificationCapable(
  provider: IdentityProvider,
): provider is IdentityProvider & IdentityVerificationCapable {
  const candidate = provider as Partial<IdentityVerificationCapable>;
  return (
    typeof candidate.createIdentityVerification === 'function' &&
    typeof candidate.retrieveIdentityVerification === 'function' &&
    typeof candidate.cancelIdentityVerification === 'function' &&
    typeof candidate.redactIdentityVerification === 'function'
  );
}
