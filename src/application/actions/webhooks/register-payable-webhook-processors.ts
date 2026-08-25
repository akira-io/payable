import type { QueueDriver, QueueJob } from '../../../domain/contracts/queue-driver.contract';
import type { DependencyFactory } from '../../builders/dependency-factory';
import {
  PROCESS_TREASURY_WEBHOOK_JOB,
  ProcessTreasuryWebhookAction,
  type ProcessTreasuryWebhookJobPayload,
} from '../treasury-webhooks/process-treasury-webhook.action';
import {
  PROCESS_WEBHOOK_JOB,
  ProcessWebhookAction,
  type ProcessWebhookJobPayload,
} from './process-webhook.action';

export function registerPayableWebhookProcessors(
  queue: QueueDriver,
  factory: DependencyFactory,
): void {
  queue.process(PROCESS_WEBHOOK_JOB, async (job: QueueJob) => {
    const payload = job.payload as ProcessWebhookJobPayload;
    await new ProcessWebhookAction(factory.webhook(payload.providerName)).handle(payload);
  });
  queue.process(PROCESS_TREASURY_WEBHOOK_JOB, async (job: QueueJob) => {
    const payload = job.payload as ProcessTreasuryWebhookJobPayload;
    await new ProcessTreasuryWebhookAction(factory.treasuryWebhook(payload.providerName)).handle(
      payload,
    );
  });
}
