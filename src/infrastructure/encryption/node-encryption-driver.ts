import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { Encryption } from '../../domain/contracts/encryption.contract';
import { PayableError } from '../../domain/errors/payable-error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;
const ENVELOPE_VERSION = 'v1';
const DEFAULT_KEY_ID = 'default';
const SCRYPT_COST = 2 ** 16;
const SCRYPT_MAXMEM = 192 * 1024 * 1024;
const RAW_KEY_PATTERN = /^[0-9a-f]{64}$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

export interface EncryptionKeyMaterial {
  id: string;
  key: string;
  salt?: string | Buffer;
}

export interface NodeEncryptionOptions {
  key?: string;
  salt?: string | Buffer;
  keys?: EncryptionKeyMaterial[];
  activeKeyId?: string;
}

interface ResolvedEnvelope {
  key: Buffer;
  aad: string;
  iv: string;
  tag: string;
  data: string;
}

export function generateEncryptionKey(): string {
  return randomBytes(KEY_BYTES).toString('hex');
}

export function legacyDerivedSalt(key: string): Buffer {
  return createHash('sha256').update(`payable.encryption.kdf.v1:${key}`).digest();
}

function deriveKey(key: string, salt?: string | Buffer): Buffer {
  if (key.trim().length === 0) {
    throw new PayableError('Encryption key must be a non-empty high-entropy secret', {
      code: 'ENCRYPTION_KEY_REQUIRED',
    });
  }
  if (RAW_KEY_PATTERN.test(key)) {
    return Buffer.from(key, 'hex');
  }
  const emptySalt =
    salt === undefined || (typeof salt === 'string' ? salt.trim().length === 0 : salt.length === 0);
  if (emptySalt) {
    throw new PayableError(
      'A passphrase encryption key requires an explicit salt; provide a unique salt or use a 32-byte raw hex key from generateEncryptionKey()',
      { code: 'ENCRYPTION_SALT_REQUIRED' },
    );
  }
  return scryptSync(key, salt, KEY_BYTES, { N: SCRYPT_COST, r: 8, p: 1, maxmem: SCRYPT_MAXMEM });
}

export class NodeEncryptionDriver implements Encryption {
  private readonly keys = new Map<string, Buffer>();
  private readonly activeKeyId: string;

  constructor(options: NodeEncryptionOptions) {
    const materials =
      options.keys ??
      (options.key !== undefined
        ? [{ id: DEFAULT_KEY_ID, key: options.key, salt: options.salt }]
        : []);
    if (materials.length === 0) {
      throw new PayableError('Encryption requires a key or a non-empty keyring', {
        code: 'ENCRYPTION_KEY_REQUIRED',
      });
    }
    for (const material of materials) {
      if (!KEY_ID_PATTERN.test(material.id)) {
        throw new PayableError(`Invalid encryption key id: ${material.id}`, {
          code: 'ENCRYPTION_KEY_ID_INVALID',
        });
      }
      this.keys.set(material.id, deriveKey(material.key, material.salt));
    }
    this.activeKeyId = options.activeKeyId ?? materials[materials.length - 1]?.id ?? DEFAULT_KEY_ID;
    if (!this.keys.has(this.activeKeyId)) {
      throw new PayableError(`Active key id is not present in the keyring: ${this.activeKeyId}`, {
        code: 'ENCRYPTION_ACTIVE_KEY_UNKNOWN',
      });
    }
  }

  async encrypt(plaintext: string): Promise<string> {
    const keyId = this.activeKeyId;
    const key = this.keys.get(keyId) as Buffer;
    const iv = randomBytes(IV_BYTES);
    const aad = `${ENVELOPE_VERSION}:${keyId}`;
    const cipher = createCipheriv(ALGORITHM, key, iv);
    cipher.setAAD(Buffer.from(aad, 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${aad}:${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const resolved = this.resolveEnvelope(ciphertext.split(':'));
    try {
      const decipher = createDecipheriv(
        ALGORITHM,
        resolved.key,
        Buffer.from(resolved.iv, 'base64'),
      );
      decipher.setAAD(Buffer.from(resolved.aad, 'utf8'));
      decipher.setAuthTag(Buffer.from(resolved.tag, 'base64'));
      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(resolved.data, 'base64')),
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

  private resolveEnvelope(parts: string[]): ResolvedEnvelope {
    if (parts[0] === ENVELOPE_VERSION && parts.length === 5) {
      const [, keyId, iv, tag, data] = parts as [string, string, string, string, string];
      if (keyId && iv && tag && data) {
        return { key: this.keyForId(keyId), aad: `${ENVELOPE_VERSION}:${keyId}`, iv, tag, data };
      }
    }
    throw new PayableError('Malformed ciphertext', { code: 'ENCRYPTION_INVALID_CIPHERTEXT' });
  }

  private keyForId(keyId: string): Buffer {
    const key = this.keys.get(keyId);
    if (!key) {
      throw new PayableError(`No encryption key available for id: ${keyId}`, {
        code: 'ENCRYPTION_KEY_UNKNOWN',
      });
    }
    return key;
  }
}
