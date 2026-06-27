import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Clock } from '../../../domain/contracts/clock.contract';
import type { Logger } from '../../../domain/contracts/logger.contract';
import type { OutboxEvent } from '../../../domain/contracts/outbox-event-repository.contract';
import type { StorageDriver } from '../../../domain/contracts/storage-driver.contract';
import type { WebhookEndpoint } from '../../../domain/entities/webhook-endpoint.entity';
import { PayableError } from '../../../domain/errors/payable-error';
import { signWebhookPayload } from '../../../support/hash/webhook-signature';
import { isBlockedHostname, isBlockedIp } from '../../../support/net/blocked-host';

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BODY = 2_000;
export const DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS = 10;
const VERSION_SUFFIX = /\.v\d+$/;

export type HostResolver = (hostname: string) => Promise<string[]>;

export interface WebhookDeliveryOptions {
  fetch?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  logger?: Logger;
  resolveHost?: HostResolver;
}

const defaultResolveHost: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

interface DeliveryOutcome {
  ok: boolean;
  responseCode: number | null;
  responseBody: string | null;
}

type ResolvedTarget = { ok: true; addresses: string[] } | { ok: false; host: string };

export function pinnedLookup(addresses: string[]): LookupFunction {
  return ((_hostname, _options, callback) => {
    const address = addresses.find((candidate) => !isBlockedIp(candidate));
    if (!address) {
      callback(new Error('Webhook delivery target resolved to a non-routable address'), '', 0);
      return;
    }
    callback(null, address, isIP(address) === 6 ? 6 : 4);
  }) as LookupFunction;
}

export class WebhookDeliveryService {
  private readonly customFetch?: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly logger?: Logger;
  private readonly resolveHost: HostResolver;

  constructor(
    private readonly storage: StorageDriver,
    private readonly clock: Clock,
    options: WebhookDeliveryOptions = {},
  ) {
    this.customFetch = options.fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_WEBHOOK_DELIVERY_ATTEMPTS;
    this.logger = options.logger;
    this.resolveHost = options.resolveHost ?? defaultResolveHost;
  }

  async handle(event: OutboxEvent): Promise<void> {
    const eventType = event.eventType.replace(VERSION_SUFFIX, '');
    const endpoints = await this.storage.webhookEndpoints.listEnabledForEvent(
      eventType,
      event.tenantId,
    );
    if (endpoints.length === 0) {
      return;
    }
    const prior = await this.storage.webhookDeliveries.listForEvent(event.id, event.tenantId);
    const delivered = new Set(
      prior.filter((entry) => entry.status === 'delivered').map((entry) => entry.endpointId),
    );
    const body = JSON.stringify({
      id: event.id,
      type: eventType,
      createdAt: event.createdAt.toISOString(),
      data: event.payload,
    });
    const timestamp = Math.floor(this.clock.now().getTime() / 1000);
    let incomplete = false;
    for (const endpoint of endpoints) {
      if (delivered.has(endpoint.id)) {
        continue;
      }
      const previousAttempts = prior
        .filter((entry) => entry.endpointId === endpoint.id)
        .reduce((max, entry) => Math.max(max, entry.attempts), 0);
      const attempts = previousAttempts + 1;
      const outcome = await this.post(endpoint, eventType, event.id, body, timestamp);
      await this.storage.webhookDeliveries.record({
        tenantId: event.tenantId,
        endpointId: endpoint.id,
        eventId: event.id,
        eventType,
        payload: event.payload,
        status: outcome.ok ? 'delivered' : 'failed',
        attempts,
        responseCode: outcome.responseCode,
        responseBody: outcome.responseBody,
      });
      if (outcome.ok) {
        continue;
      }
      if (attempts >= this.maxAttempts) {
        await this.storage.webhookEndpoints.setStatus(endpoint.id, 'disabled', event.tenantId);
        this.logger?.warn('Webhook endpoint disabled after reaching the delivery attempt limit', {
          endpointId: endpoint.id,
          eventId: event.id,
          attempts,
        });
        continue;
      }
      incomplete = true;
    }
    if (incomplete) {
      throw new PayableError('One or more webhook endpoints failed delivery', {
        code: 'WEBHOOK_DELIVERY_INCOMPLETE',
        context: { eventId: event.id, eventType },
      });
    }
  }

  private async post(
    endpoint: WebhookEndpoint,
    eventType: string,
    eventId: string,
    body: string,
    timestamp: number,
  ): Promise<DeliveryOutcome> {
    const signature = await signWebhookPayload(endpoint.secret, `${timestamp}.${body}`);
    const target = await this.resolveTarget(endpoint.url);
    if (!target.ok) {
      this.logger?.warn('Webhook delivery blocked: endpoint resolves to a non-routable host', {
        endpointId: endpoint.id,
        eventId,
        host: target.host,
      });
      return { ok: false, responseCode: null, responseBody: `blocked host: ${target.host}` };
    }
    const headers = {
      'content-type': 'application/json',
      'payable-event-id': eventId,
      'payable-event-type': eventType,
      'payable-signature': `t=${timestamp},v1=${signature}`,
    };
    try {
      const outcome = this.customFetch
        ? await this.fetchDeliver(endpoint.url, headers, body)
        : await this.secureDeliver(endpoint.url, headers, body, target.addresses);
      if (!outcome.ok && outcome.responseBody === 'redirect not followed') {
        this.logger?.warn('Webhook delivery blocked: endpoint returned a redirect', {
          endpointId: endpoint.id,
          eventId,
          responseCode: outcome.responseCode,
        });
      }
      return outcome;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn('Webhook delivery request failed', {
        endpointId: endpoint.id,
        eventId,
        error: message,
      });
      return { ok: false, responseCode: null, responseBody: message };
    }
  }

  private async resolveTarget(url: string): Promise<ResolvedTarget> {
    const hostname = new URL(url).hostname;
    if (isBlockedHostname(hostname)) {
      return { ok: false, host: hostname };
    }
    let addresses: string[];
    try {
      addresses = await this.resolveHost(hostname);
    } catch {
      return { ok: false, host: hostname };
    }
    if (addresses.length === 0 || addresses.some((address) => isBlockedIp(address))) {
      return { ok: false, host: hostname };
    }
    return { ok: true, addresses };
  }

  private async fetchDeliver(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<DeliveryOutcome> {
    const fetchImpl = this.customFetch as typeof globalThis.fetch;
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      return { ok: false, responseCode: response.status, responseBody: 'redirect not followed' };
    }
    return {
      ok: response.ok,
      responseCode: response.status,
      responseBody: await this.read(response),
    };
  }

  private secureDeliver(
    url: string,
    headers: Record<string, string>,
    body: string,
    addresses: string[],
  ): Promise<DeliveryOutcome> {
    const requestFn = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;
    return new Promise<DeliveryOutcome>((resolve) => {
      const req = requestFn(
        url,
        {
          method: 'POST',
          headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) },
          lookup: pinnedLookup(addresses),
          timeout: this.timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            res.destroy();
            resolve({ ok: false, responseCode: status, responseBody: 'redirect not followed' });
            return;
          }
          let data = '';
          let truncated = false;
          res.setEncoding('utf8');
          res.on('data', (chunk: string) => {
            if (truncated) {
              return;
            }
            data += chunk;
            if (data.length >= MAX_RESPONSE_BODY) {
              data = data.slice(0, MAX_RESPONSE_BODY);
              truncated = true;
              res.destroy();
            }
          });
          const finish = () =>
            resolve({
              ok: status >= 200 && status < 300,
              responseCode: status,
              responseBody: data,
            });
          res.on('end', finish);
          res.on('close', finish);
        },
      );
      req.on('timeout', () => req.destroy(new Error('Webhook delivery timed out')));
      req.on('error', (error: Error) =>
        resolve({ ok: false, responseCode: null, responseBody: error.message }),
      );
      req.write(body);
      req.end();
    });
  }

  private async read(response: Response): Promise<string | null> {
    try {
      const text = await response.text();
      return text.length > MAX_RESPONSE_BODY ? text.slice(0, MAX_RESPONSE_BODY) : text;
    } catch {
      return null;
    }
  }
}
