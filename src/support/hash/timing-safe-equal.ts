import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

export function timingSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return cryptoTimingSafeEqual(a, b);
}
