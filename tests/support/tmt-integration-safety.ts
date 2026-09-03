const SENSITIVE_KEY =
  /(authorization|secret|token|signature|api[-_]?key|cookie|card|cvv|cvc|pin)/iu;
const RESOURCE_ID_KEY = /(^id$|uuid|trust_id|provider.*id|booking.*id|transaction.*id|linked_id)/iu;
const EMAIL = /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/gu;
const URL = /https?:\/\/[^\s"']+/gu;

export interface TmtCleanupFailure {
  resource: 'booking';
  message: string;
}

export function sanitizeTmtEvidence(
  value: unknown,
  secrets: readonly string[] = [],
  resourceIds: readonly string[] = [],
): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTmtEvidence(item, secrets, resourceIds));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => {
        if (SENSITIVE_KEY.test(key)) return [key, '[redacted]'];
        if (RESOURCE_ID_KEY.test(key)) return [key, '[provider-resource-id]'];
        return [key, sanitizeTmtEvidence(item, secrets, resourceIds)];
      }),
    );
  }
  if (typeof value !== 'string') return value;

  let sanitized = value;
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, '[redacted]');
  }
  for (const resourceId of resourceIds) {
    if (resourceId) sanitized = sanitized.replaceAll(resourceId, '[provider-resource-id]');
  }
  return sanitized.replace(EMAIL, '[email]').replace(URL, '[url]');
}

export async function runWithSanitizedTmtErrors<T>(
  operation: () => Promise<T>,
  secrets: readonly string[] = [],
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    const value =
      error instanceof Error
        ? { name: error.name, message: error.message, ...Object.fromEntries(Object.entries(error)) }
        : error;
    throw new Error(JSON.stringify(sanitizeTmtEvidence(value, secrets)));
  }
}

export class TmtResourceLedger {
  private readonly bookingIds: number[] = [];

  trackBooking(id: number): void {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error('TMT cleanup booking ID must be a positive integer');
    }
    if (!this.bookingIds.includes(id)) this.bookingIds.push(id);
  }

  async cleanup(removeBooking: (id: number) => Promise<unknown>): Promise<TmtCleanupFailure[]> {
    const failures: TmtCleanupFailure[] = [];
    for (const id of [...this.bookingIds].reverse()) {
      try {
        await removeBooking(id);
        this.bookingIds.splice(this.bookingIds.indexOf(id), 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push({
          resource: 'booking',
          message: sanitizeTmtEvidence(message, [], [String(id)]) as string,
        });
      }
    }
    return failures;
  }
}
