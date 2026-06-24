import type { QueueDriver } from '../../../domain/contracts/queue-driver.contract';
import { PROCESS_WEBHOOK_JOB, type ProcessWebhookJobPayload } from './process-webhook.action';

export class DispatchWebhookJobAction {
  constructor(private readonly queue: QueueDriver) {}

  async handle(payload: ProcessWebhookJobPayload): Promise<void> {
    await this.queue.dispatch({
      name: PROCESS_WEBHOOK_JOB,
      payload,
      correlationId: payload.correlationId,
      idempotencyKey: payload.webhookEventId,
    });
  }
}
