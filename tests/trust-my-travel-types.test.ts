import { describe, expect, expectTypeOf, it } from 'vitest';
import type { Clock } from '../src/domain/contracts/clock.contract';
import type { Logger } from '../src/domain/contracts/logger.contract';
import { resolveTrustMyTravelEnvironment } from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-environment';
import type {
  TrustMyTravelAccountMode,
  TrustMyTravelAccountType,
  TrustMyTravelAllocationOperator,
  TrustMyTravelChannelResponse,
  TrustMyTravelEnvironment,
  TrustMyTravelLanguage,
  TrustMyTravelPaymentMethod,
  TrustMyTravelProtectionType,
  TrustMyTravelProviderOptions,
  TrustMyTravelStatementPeriod,
  TrustMyTravelTransactionType,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-types';
import {
  TRUST_MY_TRAVEL_ACCOUNT_MODES,
  TRUST_MY_TRAVEL_ACCOUNT_TYPES,
  TRUST_MY_TRAVEL_ALLOCATION_OPERATORS,
  TRUST_MY_TRAVEL_ENVIRONMENTS,
  TRUST_MY_TRAVEL_LANGUAGES,
  TRUST_MY_TRAVEL_PAYMENT_METHODS,
  TRUST_MY_TRAVEL_PROTECTION_TYPES,
  TRUST_MY_TRAVEL_STATEMENT_PERIODS,
  TRUST_MY_TRAVEL_TRANSACTION_TYPES,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-types';

describe('Trust My Travel types', () => {
  it('keeps values sent to Trust My Travel constrained to documented enums', () => {
    expect(TRUST_MY_TRAVEL_ENVIRONMENTS).toEqual(['test', 'live']);
    expect(TRUST_MY_TRAVEL_ACCOUNT_MODES).toEqual(['test', 'draft', 'live', 'closed', 'affiliate']);
    expect(TRUST_MY_TRAVEL_ACCOUNT_TYPES).toEqual(['protected-processing', 'trust']);
    expect(TRUST_MY_TRAVEL_PROTECTION_TYPES).toEqual(['trust-my-travel', 'tmu-management']);
    expect(TRUST_MY_TRAVEL_STATEMENT_PERIODS).toEqual(['biweek', 'week', 'month']);
    expect(TRUST_MY_TRAVEL_TRANSACTION_TYPES).toEqual([
      'purchase',
      'authorize',
      'capture',
      'void',
      'refund',
      'vault',
      'retained_purchase',
      'chargeback',
    ]);
    expect(TRUST_MY_TRAVEL_PAYMENT_METHODS).toEqual(['bank-transfer', 'credit-card']);
    expect(TRUST_MY_TRAVEL_ALLOCATION_OPERATORS).toEqual(['percent', 'flat']);
    expect(TRUST_MY_TRAVEL_LANGUAGES).toEqual([
      'deDE',
      'enGB',
      'esES',
      'frFR',
      'itIT',
      'jaJA',
      'kkKK',
      'koKO',
      'lvLV',
      'ptBR',
      'roRO',
      'ruRU',
      'ukUK',
      'uzUZ',
      'zhZH',
    ]);

    expectTypeOf<TrustMyTravelEnvironment>().toEqualTypeOf<'test' | 'live'>();
    expectTypeOf<TrustMyTravelAccountMode>().toEqualTypeOf<
      'test' | 'draft' | 'live' | 'closed' | 'affiliate'
    >();
    expectTypeOf<TrustMyTravelAccountType>().toEqualTypeOf<'protected-processing' | 'trust'>();
    expectTypeOf<TrustMyTravelProtectionType>().toEqualTypeOf<
      'trust-my-travel' | 'tmu-management'
    >();
    expectTypeOf<TrustMyTravelStatementPeriod>().toEqualTypeOf<'biweek' | 'week' | 'month'>();
    expectTypeOf<TrustMyTravelTransactionType>().toEqualTypeOf<
      | 'purchase'
      | 'authorize'
      | 'capture'
      | 'void'
      | 'refund'
      | 'vault'
      | 'retained_purchase'
      | 'chargeback'
    >();
    expectTypeOf<TrustMyTravelPaymentMethod>().toEqualTypeOf<'bank-transfer' | 'credit-card'>();
    expectTypeOf<TrustMyTravelAllocationOperator>().toEqualTypeOf<'percent' | 'flat'>();
    expectTypeOf<TrustMyTravelLanguage>().toEqualTypeOf<
      | 'deDE'
      | 'enGB'
      | 'esES'
      | 'frFR'
      | 'itIT'
      | 'jaJA'
      | 'kkKK'
      | 'koKO'
      | 'lvLV'
      | 'ptBR'
      | 'roRO'
      | 'ruRU'
      | 'ukUK'
      | 'uzUZ'
      | 'zhZH'
    >();
  });

  it('keeps provider response classifications open to upstream additions', () => {
    expectTypeOf<TrustMyTravelChannelResponse['account_type']>().toEqualTypeOf<string>();
    expectTypeOf<TrustMyTravelChannelResponse['account_mode']>().toEqualTypeOf<string>();
    expectTypeOf<TrustMyTravelChannelResponse['protection_type']>().toEqualTypeOf<string>();
    expectTypeOf<TrustMyTravelChannelResponse['channel_status']>().toEqualTypeOf<string>();
    expectTypeOf<TrustMyTravelChannelResponse['statement_period']>().toEqualTypeOf<string>();
    expectTypeOf<TrustMyTravelChannelResponse['language']>().toEqualTypeOf<string>();
  });

  it('derives an environment only from active channel modes', () => {
    expect(resolveTrustMyTravelEnvironment('test')).toBe('test');
    expect(resolveTrustMyTravelEnvironment('live')).toBe('live');
  });

  it.each([
    'draft',
    'closed',
    'affiliate',
    'restricted',
  ])('rejects the inactive or unknown channel mode %s', (accountMode) => {
    expect(() => resolveTrustMyTravelEnvironment(accountMode)).toThrowError(
      expect.objectContaining({
        code: 'PROVIDER_TMT_CHANNEL_MODE_UNSUPPORTED',
        context: { provider: 'trust-my-travel', accountMode },
      }),
    );
  });

  it('declares every required and optional provider option', () => {
    expectTypeOf<TrustMyTravelProviderOptions>().toEqualTypeOf<{
      path: string;
      apiToken: string;
      channelId: number;
      channelSecret: string;
      currency: string;
      environment: TrustMyTravelEnvironment;
      modalVersion?: string;
      baseUrl?: string;
      fetch?: typeof fetch;
      logger?: Logger;
      clock?: Clock;
      directCharge?: { psp: string };
      reconciliation?: {
        maxAttempts?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
      };
    }>();
  });
});
