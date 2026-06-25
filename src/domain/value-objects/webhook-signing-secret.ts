const SECRET_BYTES = 32;

export class WebhookSigningSecret {
  private constructor(readonly value: string) {}

  static generate(): WebhookSigningSecret {
    const bytes = new Uint8Array(SECRET_BYTES);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return new WebhookSigningSecret(`whsec_${hex}`);
  }

  toString(): string {
    return this.value;
  }
}
