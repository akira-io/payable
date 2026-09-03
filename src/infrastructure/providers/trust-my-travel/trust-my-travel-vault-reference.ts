import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { PayableError } from '../../../domain/errors/payable-error';

interface SetupReference {
  kind: 'setup';
  sessionId: string;
  customerId: string;
  sitePath: string;
  channelId: number;
  currency: string;
  accountType: string;
  environment: string;
  createdAt: string;
}

export interface PaymentMethodReference {
  kind: 'payment-method';
  transactionId: number;
  sitePath: string;
  channelId: number;
  currency: string;
  accountType: string;
  environment: string;
  createdAt: string;
}

type VaultReference = SetupReference | PaymentMethodReference;

export class TrustMyTravelVaultReferenceCodec {
  private readonly keys: readonly Buffer[];

  constructor(secrets: readonly string[] | undefined) {
    if (
      !secrets ||
      secrets.length === 0 ||
      secrets.some((secret) => typeof secret !== 'string' || Buffer.byteLength(secret) < 32)
    ) {
      throw missingReferenceSecret();
    }
    this.keys = (secrets ?? []).map((secret) =>
      createHash('sha256').update(`payable:tmt:vault-reference:${secret}`).digest(),
    );
  }

  sealSetup(reference: Omit<SetupReference, 'kind'>): string {
    return this.seal({ kind: 'setup', ...reference }, 'tmtsetup1');
  }

  openSetup(reference: string): SetupReference {
    const opened = this.open(reference, 'tmtsetup1');
    if (opened.kind !== 'setup') throw invalidReference();
    return opened;
  }

  sealPaymentMethod(reference: Omit<PaymentMethodReference, 'kind'>): string {
    return this.seal({ kind: 'payment-method', ...reference }, 'tmtpm1');
  }

  openPaymentMethod(reference: string): PaymentMethodReference {
    const opened = this.open(reference, 'tmtpm1');
    if (opened.kind !== 'payment-method') throw invalidReference();
    return opened;
  }

  private seal(reference: VaultReference, prefix: string): string {
    const key = this.keys[0];
    if (!key) throw missingReferenceSecret();
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(reference), 'utf8'),
      cipher.final(),
    ]);
    return `${prefix}.${Buffer.concat([
      initializationVector,
      cipher.getAuthTag(),
      encrypted,
    ]).toString('base64url')}`;
  }

  private open(reference: string, prefix: string): VaultReference {
    if (this.keys.length === 0) throw missingReferenceSecret();
    try {
      const [actualPrefix, encoded, extra] = reference.split('.');
      if (actualPrefix !== prefix || !encoded || extra !== undefined) throw invalidReference();
      const packed = Buffer.from(encoded, 'base64url');
      if (packed.length <= 28) throw invalidReference();
      for (const key of this.keys) {
        try {
          const decipher = createDecipheriv('aes-256-gcm', key, packed.subarray(0, 12));
          decipher.setAuthTag(packed.subarray(12, 28));
          const plaintext = Buffer.concat([
            decipher.update(packed.subarray(28)),
            decipher.final(),
          ]).toString('utf8');
          return JSON.parse(plaintext) as VaultReference;
        } catch {}
      }
      throw invalidReference();
    } catch (error) {
      if (error instanceof PayableError) throw error;
      throw invalidReference();
    }
  }
}

function missingReferenceSecret(): PayableError {
  return new PayableError('Trust My Travel vault reference secret is not configured', {
    code: 'PROVIDER_TMT_VAULT_REFERENCE_SECRET_REQUIRED',
    context: { provider: 'trust-my-travel' },
  });
}

function invalidReference(): PayableError {
  return new PayableError('Trust My Travel vault reference is invalid', {
    code: 'PROVIDER_TMT_VAULT_REFERENCE_INVALID',
    context: { provider: 'trust-my-travel' },
  });
}
