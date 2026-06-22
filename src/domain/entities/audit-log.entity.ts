import type { TenantScoped } from './common';

export interface AuditLog extends TenantScoped {
  readonly id: string;
  readonly correlationId: string;
  readonly actorType: string | null;
  readonly actorId: string | null;
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly metadata: Record<string, unknown> | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Date;
}
