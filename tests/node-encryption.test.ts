import { describe, expect, it } from 'vitest';
import { NodeEncryptionDriver } from '../src/infrastructure/encryption/node-encryption-driver';

describe('NodeEncryptionDriver', () => {
  it('round-trips a value without exposing the plaintext', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key' });
    const token = await driver.encrypt('customer@example.com');

    expect(token).not.toContain('customer@example.com');
    expect(await driver.decrypt(token)).toBe('customer@example.com');
  });

  it('tags the envelope with a version and still reads legacy tokens', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key' });
    const token = await driver.encrypt('secret');

    expect(token.startsWith('v1:')).toBe(true);
    const legacy = token.slice('v1:'.length);
    expect(await driver.decrypt(legacy)).toBe('secret');
  });

  it('produces a fresh ciphertext per call', async () => {
    const driver = new NodeEncryptionDriver({ key: 'a-secret-key' });
    const a = await driver.encrypt('same');
    const b = await driver.encrypt('same');
    expect(a).not.toBe(b);
    expect(await driver.decrypt(a)).toBe('same');
    expect(await driver.decrypt(b)).toBe('same');
  });

  it('fails to decrypt with the wrong key as a coded PayableError', async () => {
    const token = await new NodeEncryptionDriver({ key: 'right' }).encrypt('secret');
    await expect(new NodeEncryptionDriver({ key: 'wrong' }).decrypt(token)).rejects.toMatchObject({
      code: 'ENCRYPTION_DECRYPT_FAILED',
    });
  });

  it('rejects malformed ciphertext', async () => {
    const driver = new NodeEncryptionDriver({ key: 'k' });
    await expect(driver.decrypt('not-a-token')).rejects.toThrow('Malformed ciphertext');
  });

  it('rejects an empty key at construction', () => {
    expect(() => new NodeEncryptionDriver({ key: '' })).toThrow('non-empty');
    expect(() => new NodeEncryptionDriver({ key: '   ' })).toThrow('non-empty');
  });

  it('derives the same key deterministically across instances', async () => {
    const token = await new NodeEncryptionDriver({ key: 'shared-passphrase' }).encrypt('secret');
    const other = new NodeEncryptionDriver({ key: 'shared-passphrase' });
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

  it('derives a per-key salt by default rather than a shared constant', async () => {
    const token = await new NodeEncryptionDriver({ key: 'k' }).encrypt('secret');
    await expect(
      new NodeEncryptionDriver({ key: 'k', salt: 'explicit' }).decrypt(token),
    ).rejects.toThrow();
  });
});
