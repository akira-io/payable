import type { Repositories } from '../../../domain/contracts/storage-driver.contract';
import type { VerifiedWebhook } from '../../../domain/dtos/webhook.dto';
import type { WebhookDependencies } from '../../builders/webhook-dependencies';

export interface WebhookReconciliationContext {
  deps: WebhookDependencies;
  repos: Repositories;
  verified: VerifiedWebhook;
  occurredAt: Date;
  tenantId: string | null;
}
