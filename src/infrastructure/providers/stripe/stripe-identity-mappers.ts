import type Stripe from 'stripe';
import type {
  CreateIdentityVerificationInput,
  IdentityCheck,
  IdentityVerificationDTO,
  IdentityVerificationStatus,
} from '../../../domain/dtos/identity.dto';
import { PayableError } from '../../../domain/errors/payable-error';

export function stripeIdentityVerificationParams(
  input: CreateIdentityVerificationInput,
): Stripe.Identity.VerificationSessionCreateParams {
  const checks = new Set(input.checks);
  const unsupported = [...checks].filter(
    (check) => check !== 'document' && check !== 'selfie' && check !== 'id_number',
  );
  if (checks.size === 0 || unsupported.length > 0) {
    throw unsupportedIdentityChecks(input.checks);
  }
  if (checks.has('selfie') && !checks.has('document')) {
    throw unsupportedIdentityChecks(input.checks);
  }
  const common = {
    client_reference_id: input.reference,
    metadata: { reference: input.reference },
    return_url: input.returnUrl,
  };
  if (checks.has('document')) {
    return {
      ...common,
      type: 'document',
      options: {
        document: {
          require_matching_selfie: checks.has('selfie') || undefined,
          require_id_number: checks.has('id_number') || undefined,
        },
      },
    };
  }
  if (checks.size === 1 && checks.has('id_number')) {
    return { ...common, type: 'id_number', options: undefined };
  }
  throw unsupportedIdentityChecks(input.checks);
}

export function mapStripeIdentityVerification(
  session: Stripe.Identity.VerificationSession,
): IdentityVerificationDTO {
  return {
    providerVerificationId: session.id,
    reference: stripeIdentityReference(session),
    checks: stripeIdentityChecks(session),
    status: stripeIdentityStatus(session),
    clientSecret: session.client_secret,
    verificationUrl: session.url,
    verifiedAt: null,
    createdAt: new Date(session.created * 1000),
  };
}

function stripeIdentityReference(session: Stripe.Identity.VerificationSession): string {
  if (session.client_reference_id) {
    return session.client_reference_id;
  }
  const reference = session.metadata.reference;
  return typeof reference === 'string' ? reference : '';
}

function stripeIdentityChecks(session: Stripe.Identity.VerificationSession): IdentityCheck[] {
  if (session.type === 'id_number') {
    return ['id_number'];
  }
  if (session.type !== 'document') {
    return [];
  }
  const checks: IdentityCheck[] = ['document'];
  if (session.options?.document?.require_matching_selfie) {
    checks.push('selfie');
  }
  if (session.options?.document?.require_id_number) {
    checks.push('id_number');
  }
  return checks;
}

function stripeIdentityStatus(
  session: Stripe.Identity.VerificationSession,
): IdentityVerificationStatus {
  if (session.redaction?.status === 'redacted') {
    return 'redacted';
  }
  if (session.redaction?.status === 'processing' || session.redaction?.status === 'validated') {
    return 'processing';
  }
  switch (session.status) {
    case 'requires_input':
    case 'processing':
    case 'verified':
      return session.status;
    case 'canceled':
      return 'canceled';
    default:
      return 'unknown';
  }
}

function unsupportedIdentityChecks(checks: IdentityCheck[]): PayableError {
  return new PayableError('Stripe Identity does not support this verification check combination', {
    code: 'PROVIDER_OPERATION_UNSUPPORTED',
    context: { provider: 'stripe-identity', checks },
  });
}
