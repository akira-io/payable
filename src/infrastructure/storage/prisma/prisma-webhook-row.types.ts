export interface PrismaWebhookEventRow {
  id: string;
  tenantId: string;
  provider: string;
  providerEventId: string;
  type: string;
  normalizedType: string | null;
  payload: string;
  signature: string | null;
  data: string;
  headers: string;
  status: string;
  correlationId: string;
  occurredAt: Date | null;
  receivedAt: Date;
  processedAt: Date | null;
  claimedUntil: Date | null;
  claimToken: string | null;
}

export interface PrismaWebhookEndpointRow {
  id: string;
  tenantId: string | null;
  url: string;
  events: string;
  secret: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface PrismaWebhookEndpointEventRow {
  endpointId: string;
  eventType: string;
}

export interface PrismaWebhookDeliveryRow {
  id: string;
  tenantId: string | null;
  tenantKey?: string;
  endpointId: string;
  eventId: string | null;
  eventType: string;
  payload: string;
  status: string;
  attempts: number;
  responseCode: number | null;
  responseBody: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
