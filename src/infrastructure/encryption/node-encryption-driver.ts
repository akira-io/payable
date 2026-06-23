import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Encryption } from '../../domain/contracts/encryption.contract';
import { PayableError } from '../../domain/errors/payable-error';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

export class NodeEncryptionDriver implements Encryption {
  private readonly key: Buffer;

  constructor(options: { key: string }) {
    if (options.key.trim().length === 0) {
      throw new PayableError('Encryption key must be a non-empty high-entropy secret', {
        code: 'ENCRYPTION_KEY_REQUIRED',
      });
    }
    this.key = createHash('sha256').update(options.key).digest();
  }

  async encrypt(plaintext: string): Promise<string> {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  async decrypt(ciphertext: string): Promise<string> {
    const [ivPart, tagPart, dataPart] = ciphertext.split(':');
    if (!ivPart || !tagPart || !dataPart) {
      throw new PayableError('Malformed ciphertext', { code: 'ENCRYPTION_INVALID_CIPHERTEXT' });
    }
    const decipher = createDecipheriv(ALGORITHM, this.key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataPart, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  }
}
