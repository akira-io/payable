import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { Encryption } from '../../domain/contracts/encryption.contract';
import { PayableError } from '../../domain/errors/payable-error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = 'v1';
const SCRYPT_COST = 2 ** 16;
const SCRYPT_MAXMEM = 192 * 1024 * 1024;
const RAW_KEY_PATTERN = /^[0-9a-f]{64}$/i;

export interface NodeEncryptionOptions {
  key: string;
  salt?: string | Buffer;
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

export function legacyDerivedSalt(key: string): Buffer {
  return createHash('sha256').update(`payable.encryption.kdf.v1:${key}`).digest();
}

export class NodeEncryptionDriver implements Encryption {
  private readonly key: Buffer;

  constructor(options: NodeEncryptionOptions) {
    if (options.key.trim().length === 0) {
      throw new PayableError('Encryption key must be a non-empty high-entropy secret', {
        code: 'ENCRYPTION_KEY_REQUIRED',
      });
    }
    if (RAW_KEY_PATTERN.test(options.key)) {
      this.key = Buffer.from(options.key, 'hex');
      return;
    }
    const salt = options.salt;
    if (
      salt === undefined ||
      (typeof salt === 'string' ? salt.trim().length === 0 : salt.length === 0)
    ) {
      throw new PayableError(
        'A passphrase encryption key requires an explicit salt; provide a unique salt or use a 32-byte raw hex key from generateEncryptionKey()',
        { code: 'ENCRYPTION_SALT_REQUIRED' },
      );
    }
    this.key = scryptSync(options.key, salt, KEY_BYTES, {
      N: SCRYPT_COST,
      r: 8,
      p: 1,
      maxmem: SCRYPT_MAXMEM,
    });
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    cipher.setAAD(Buffer.from(ENVELOPE_VERSION, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENVELOPE_VERSION}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const parts = ciphertext.split(':');
    const [version, ivPart, tagPart, dataPart] = parts;
    if (parts.length !== 4 || version !== ENVELOPE_VERSION || !ivPart || !tagPart || !dataPart) {
      throw new PayableError('Malformed ciphertext', { code: 'ENCRYPTION_INVALID_CIPHERTEXT' });
    }
    try {
      const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64'));
      decipher.setAAD(Buffer.from(ENVELOPE_VERSION, 'utf8'));
      decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(dataPart, 'base64')),
        decipher.final(),
      ]);
      return decrypted.toString('utf8');
    } catch (error) {
      throw new PayableError('Failed to decrypt ciphertext', {
        code: 'ENCRYPTION_DECRYPT_FAILED',
        cause: error,
      });
    }
  }
}
