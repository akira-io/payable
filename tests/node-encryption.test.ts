import { describe, expect, it } from 'vitest';
import {
  generateEncryptionKey,
  NodeEncryptionDriver,
} from '../src/infrastructure/encryption/node-encryption-driver';

describe('NodeEncryptionDriver', () => {
  it('round-trips a value without exposing the plaintext', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key', salt: 'a-salt' });
    const token = await driver.encrypt('customer@example.com');

    expect(token).not.toContain('customer@example.com');
    expect(await driver.decrypt(token)).toBe('customer@example.com');
  });

  it('uses a full-entropy 32-byte hex key directly without scrypt', async () => {
    const rawKey = 'a'.repeat(64);
    const token = await new NodeEncryptionDriver({ key: rawKey }).encrypt('secret');
    expect(await new NodeEncryptionDriver({ key: rawKey }).decrypt(token)).toBe('secret');
  });

  it('round-trips with a generated raw key that needs no salt', async () => {
    const rawKey = generateEncryptionKey();
    expect(rawKey).toMatch(/^[0-9a-f]{64}$/);
    const token = await new NodeEncryptionDriver({ key: rawKey }).encrypt('secret');
    expect(await new NodeEncryptionDriver({ key: rawKey }).decrypt(token)).toBe('secret');
  });

  it('binds the envelope version into the authentication tag', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key', salt: 'a-salt' });
    const token = await driver.encrypt('secret');

    expect(token.startsWith('v1:')).toBe(true);
    const stripped = token.slice('v1:'.length);
    await expect(driver.decrypt(stripped)).rejects.toThrow('Malformed ciphertext');
  });

  it('produces a fresh ciphertext per call', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key', salt: 'a-salt' });
    const a = await driver.encrypt('same');
    const b = await driver.encrypt('same');
    expect(a).not.toBe(b);
    expect(await driver.decrypt(a)).toBe('same');
    expect(await driver.decrypt(b)).toBe('same');
  });

  it('fails to decrypt with the wrong key as a coded PayableError', async () => {
    const token = await new NodeEncryptionDriver({ key: 'right', salt: 's' }).encrypt('secret');
    await expect(
      new NodeEncryptionDriver({ key: 'wrong', salt: 's' }).decrypt(token),
    ).rejects.toMatchObject({
      code: 'ENCRYPTION_DECRYPT_FAILED',
    });
  });

  it('rejects malformed ciphertext', async () => {
    const driver = new NodeEncryptionDriver({ key: 'k', salt: 's' });
    await expect(driver.decrypt('not-a-token')).rejects.toThrow('Malformed ciphertext');
  });

  it('rejects an empty key at construction', () => {
    expect(() => new NodeEncryptionDriver({ key: '' })).toThrow('non-empty');
    expect(() => new NodeEncryptionDriver({ key: '   ' })).toThrow('non-empty');
  });

  it('derives the same key deterministically across instances with the same salt', async () => {
    const token = await new NodeEncryptionDriver({
      key: 'shared-passphrase',
      salt: 'shared-salt',
    }).encrypt('secret');
    const other = new NodeEncryptionDriver({ key: 'shared-passphrase', salt: 'shared-salt' });
    expect(await other.decrypt(token)).toBe('secret');
  });

  it('derives a distinct key per configured salt', async () => {
    const token = await new NodeEncryptionDriver({ key: 'k', salt: 'tenant-a' }).encrypt('secret');
    expect(await new NodeEncryptionDriver({ key: 'k', salt: 'tenant-a' }).decrypt(token)).toBe(
      'secret',
    );
    await expect(
      new NodeEncryptionDriver({ key: 'k', salt: 'tenant-b' }).decrypt(token),
    ).rejects.toThrow();
  });

  it('requires an explicit salt for a passphrase key', () => {
    expect(() => new NodeEncryptionDriver({ key: 'a-passphrase' })).toThrow(
      /requires an explicit salt/,
    );
    expect(() => new NodeEncryptionDriver({ key: 'a-passphrase', salt: '   ' })).toThrowError(
      expect.objectContaining({ code: 'ENCRYPTION_SALT_REQUIRED' }),
    );
  });
});
