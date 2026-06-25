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
  if (left.length !== right.length) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}
