import { timingSafeEqual as cryptoTimingSafeEqual } from 'node:crypto';

const SECRET_BYTES = 32;
const SECRET_PREFIX = 'whsec_';

export class WebhookSigningSecret {
  private constructor(readonly value: string) {}

  static generate(): WebhookSigningSecret {
    const bytes = new Uint8Array(SECRET_BYTES);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return new WebhookSigningSecret(`${SECRET_PREFIX}${hex}`);
  }

  static from(value: string): WebhookSigningSecret {
    if (!value.startsWith(SECRET_PREFIX) || value.length <= SECRET_PREFIX.length) {
      throw new TypeError(`Webhook signing secret must start with "${SECRET_PREFIX}"`);
    }
    return new WebhookSigningSecret(value);
  }

  toString(): string {
    return this.value;
  }

  equals(other: WebhookSigningSecret): boolean {
    return timingSafeEqual(this.value, other.value);
  }
}

function timingSafeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return cryptoTimingSafeEqual(a, b);
}
