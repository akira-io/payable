export interface ReplayWebhookContext {
  actorType?: string;
  actorId?: string;
  allowed?: boolean;
  tenantId?: string | null;
}

export class CanReplayWebhookPolicy {
  authorize(context: ReplayWebhookContext = {}): boolean {
    return context.allowed === true && this.hasActor(context);
  }

  private hasActor(context: ReplayWebhookContext): boolean {
    return typeof context.actorId === 'string' && context.actorId.length > 0;
  }
}
