import { createHash } from 'node:crypto';

export function sispMerchantReference(idempotencyKey: string): string {
  const digest = createHash('sha256').update(idempotencyKey).digest('hex');
  return `R${digest.slice(0, 14).toUpperCase()}`;
}
