export interface ReplayWebhookContext {
  actorType?: string;
  actorId?: string;
  allowed?: boolean;
}

export class CanReplayWebhookPolicy {
  authorize(context: ReplayWebhookContext = {}): boolean {
    return context.allowed !== false;
  }
}
