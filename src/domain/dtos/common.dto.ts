export interface OperationContext {
  correlationId: string;
  idempotencyKey?: string;
  tenantId?: string | null;
}
