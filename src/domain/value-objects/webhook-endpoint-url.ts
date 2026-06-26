import { isBlockedHostname } from '../../support/net/blocked-host';
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
    if (isBlockedHostname(parsed.hostname)) {
      throw new PayableError(`Webhook endpoint url resolves to a non-routable host: ${input}`, {
        code: 'WEBHOOK_ENDPOINT_BLOCKED_HOST',
        context: { url: input, host: parsed.hostname },
      });
    }
    return new WebhookEndpointUrl(parsed.toString());
  }

  toString(): string {
    return this.value;
  }
}
