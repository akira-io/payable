import { PayableError } from '../errors/payable-error';

export class WebhookEndpointUrl {
  private constructor(readonly value: string) {}

  static parse(input: string): WebhookEndpointUrl {
    let parsed: URL;
    try {
      parsed = new URL(input);
    } catch {
      throw new PayableError(`Webhook endpoint url is not a valid url: ${input}`, {
        code: 'WEBHOOK_ENDPOINT_INVALID_URL',
        context: { url: input },
      });
    }
    if (parsed.protocol !== 'https:') {
      throw new PayableError(`Webhook endpoint url must use https: ${input}`, {
        code: 'WEBHOOK_ENDPOINT_INVALID_URL',
        context: { url: input, protocol: parsed.protocol },
      });
    }
    return new WebhookEndpointUrl(parsed.toString());
  }

  toString(): string {
    return this.value;
  }
}
