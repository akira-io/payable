import { createHash } from 'node:crypto';
import type { Clock } from '../../../domain/contracts/clock.contract';
import { SystemClock } from '../../../support/clock/system-clock';
import { timingSafeEqual } from '../../../support/hash/timing-safe-equal';

export type TmtVerificationField =
  | 'allocations'
  | 'charge_channel'
  | 'country'
  | 'date'
  | 'email'
  | 'firstname'
  | 'reference'
  | 'surname';

type TmtAllocation = Readonly<Record<string, string | number>>;

export interface TmtAuthenticationInput {
  channels: string | number;
  currencies: string;
  total: string | number;
  allocations?: readonly TmtAllocation[];
  charge_channel?: string | number;
  country?: string;
  date?: string;
  email?: string;
  firstname?: string;
  reference?: string;
  surname?: string;
}

export interface TmtAuthentication {
  bookingAuth: string;
  verify: TmtVerificationField[];
}

export interface TmtTransactionHashInput {
  id: string | number;
  status: string;
  total: string | number;
  hash: string;
}

const REQUIRED_AUTHENTICATION_FIELDS = new Set(['channels', 'currencies', 'total']);

export function createTmtAuthentication(
  input: TmtAuthenticationInput,
  channelSecret: string,
  clock: Clock = new SystemClock(),
): TmtAuthentication {
  const timestamp = formatTmtTimestamp(clock.now());
  const entries = Object.entries(input)
    .filter((entry): entry is [string, Exclude<unknown, undefined>] => entry[1] !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  const values = entries.map(([, value]) => serializeAuthenticationValue(value));
  const verify = entries
    .map(([field]) => field)
    .filter((field) => !REQUIRED_AUTHENTICATION_FIELDS.has(field)) as TmtVerificationField[];
  const authenticationHash = doubleSha256(`${values.join('&')}&${timestamp}`, channelSecret);

  return { bookingAuth: `${authenticationHash}${timestamp}`, verify };
}

export function validateTmtTransactionHash(
  input: TmtTransactionHashInput,
  channelSecret: string,
): boolean {
  const expected = doubleSha256(`${input.id}&${input.status}&${input.total}`, channelSecret);
  return timingSafeEqual(input.hash, expected);
}

function doubleSha256(value: string, channelSecret: string): string {
  return sha256(`${sha256(value)}${channelSecret}`);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function formatTmtTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function serializeAuthenticationValue(value: unknown): string {
  return Array.isArray(value) ? JSON.stringify(value) : String(value);
}
