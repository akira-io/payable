import { InvalidWebhookSignatureError } from '../../../domain/errors/invalid-webhook-signature.error';
import type { PaddleClient, PaddleWebhookEvent } from './paddle-types';

export class PaddleWebhookVerifier {
  constructor(private readonly secret: string) {}

  async verify(
    client: PaddleClient,
    payload: string,
    signature: string,
  ): Promise<PaddleWebhookEvent> {
    const event = await this.unmarshal(client, payload, signature);
    if (!event) {
      throw new InvalidWebhookSignatureError('paddle');
    }
    return event;
  }

  private async unmarshal(
    client: PaddleClient,
    payload: string,
    signature: string,
  ): Promise<PaddleWebhookEvent | null> {
    try {
      return await client.webhooks.unmarshal(payload, this.secret, signature);
    } catch (error) {
      throw new InvalidWebhookSignatureError('paddle', { cause: error });
    }
  }
}
