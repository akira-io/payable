import { describe, expect, it } from 'vitest';
import {
  generateEncryptionKey,
  legacyDerivedSalt,
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

  it('binds the envelope version and key id into the authentication tag', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key', salt: 'a-salt' });
    const token = await driver.encrypt('secret');

    expect(token.startsWith('v1:default:')).toBe(true);
    const stripped = token.slice('v1:'.length);
    await expect(driver.decrypt(stripped)).rejects.toThrow('Malformed ciphertext');
  });

  it('rotates keys: old ciphertext decrypts by its embedded key id, new uses the active key', async () => {
    const k1 = generateEncryptionKey();
    const k2 = generateEncryptionKey();
    const before = new NodeEncryptionDriver({ keys: [{ id: 'k1', key: k1 }], activeKeyId: 'k1' });
    const legacyToken = await before.encrypt('secret');

    const rotated = new NodeEncryptionDriver({
      keys: [
        { id: 'k1', key: k1 },
        { id: 'k2', key: k2 },
      ],
      activeKeyId: 'k2',
    });
    expect(await rotated.decrypt(legacyToken)).toBe('secret');
    const freshToken = await rotated.encrypt('secret');
    expect(freshToken.startsWith('v1:k2:')).toBe(true);
    expect(await rotated.decrypt(freshToken)).toBe('secret');
  });

  it('fails to decrypt when the embedded key id is not in the keyring', async () => {
    const k1 = generateEncryptionKey();
    const k2 = generateEncryptionKey();
    const token = await new NodeEncryptionDriver({
      keys: [{ id: 'k1', key: k1 }],
      activeKeyId: 'k1',
    }).encrypt('secret');

    await expect(
      new NodeEncryptionDriver({ keys: [{ id: 'k2', key: k2 }], activeKeyId: 'k2' }).decrypt(token),
    ).rejects.toMatchObject({ code: 'ENCRYPTION_KEY_UNKNOWN' });
  });

  it('rejects an active key id missing from the keyring', () => {
    expect(
      () =>
        new NodeEncryptionDriver({
          keys: [{ id: 'k1', key: generateEncryptionKey() }],
          activeKeyId: 'k2',
        }),
    ).toThrowError(expect.objectContaining({ code: 'ENCRYPTION_ACTIVE_KEY_UNKNOWN' }));
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

  it('recovers legacy passphrase data via the legacyDerivedSalt helper', async () => {
    const key = 'legacy-passphrase';
    const salt = legacyDerivedSalt(key);
    expect(salt).toEqual(legacyDerivedSalt(key));

    const token = await new NodeEncryptionDriver({ key, salt }).encrypt('secret');
    expect(await new NodeEncryptionDriver({ key, salt }).decrypt(token)).toBe('secret');
  });
});
