import { describe, expect, it } from 'vitest';
import {
  assertTmtTestChannel,
  resolveTmtIntegrationConfig,
} from './support/tmt-integration-config';

const COMPLETE_ENV = {
  TMT_PATH: 'test-site',
  TMT_API_TOKEN: 'private-api-token',
  TMT_CHANNEL_ID: '2452',
  TMT_CHANNEL_SECRET: 'private-channel-secret',
};

describe('TMT integration configuration', () => {
  it('returns an informative skip without credentials', () => {
    expect(resolveTmtIntegrationConfig({})).toEqual({
      kind: 'skip',
      reason:
        'TMT integration skipped: set TMT_PATH, TMT_API_TOKEN, TMT_CHANNEL_ID and TMT_CHANNEL_SECRET',
    });
  });

  it('rejects partial configuration using variable names instead of values', () => {
    expect(() =>
      resolveTmtIntegrationConfig({
        TMT_PATH: COMPLETE_ENV.TMT_PATH,
        TMT_API_TOKEN: COMPLETE_ENV.TMT_API_TOKEN,
      }),
    ).toThrow('TMT_CHANNEL_ID, TMT_CHANNEL_SECRET');

    try {
      resolveTmtIntegrationConfig({ TMT_API_TOKEN: COMPLETE_ENV.TMT_API_TOKEN });
    } catch (error) {
      expect(String(error)).not.toContain(COMPLETE_ENV.TMT_API_TOKEN);
    }
  });

  it('parses a complete configuration without retaining invalid channel identifiers', () => {
    expect(resolveTmtIntegrationConfig(COMPLETE_ENV)).toEqual({
      kind: 'ready',
      config: {
        path: 'test-site',
        apiToken: 'private-api-token',
        channelId: 2452,
        channelSecret: 'private-channel-secret',
      },
    });
    expect(() => resolveTmtIntegrationConfig({ ...COMPLETE_ENV, TMT_CHANNEL_ID: '24.52' })).toThrow(
      'TMT_CHANNEL_ID must be a positive integer',
    );
  });

  it.each([
    'live',
    'draft',
    'closed',
    'affiliate',
  ])('rejects %s channels before the integration can mutate resources', (accountMode) => {
    expect(() =>
      assertTmtTestChannel(
        {
          id: 2452,
          account_mode: accountMode,
          currencies: 'EUR',
        },
        2452,
      ),
    ).toThrow('refusing a non-test channel mode');
  });

  it('accepts only the configured test channel and returns its normalized currency', () => {
    expect(
      assertTmtTestChannel({ id: 2452, account_mode: 'test', currencies: 'eur' }, 2452),
    ).toEqual({ channelId: 2452, currency: 'EUR' });

    expect(() =>
      assertTmtTestChannel({ id: 9999, account_mode: 'test', currencies: 'EUR' }, 2452),
    ).toThrow('configured channel identity');
  });
});
