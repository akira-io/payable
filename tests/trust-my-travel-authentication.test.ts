import { describe, expect, it } from 'vitest';
import {
  createTmtAuthentication,
  validateTmtTransactionHash,
} from '../src/infrastructure/providers/trust-my-travel/trust-my-travel-authentication';
import { FakeClock } from '../src/support/clock/fake-clock';

const CHANNEL_SECRET = 'MYCHANNELSECRET123';
const CLOCK = new FakeClock(new Date('2019-08-12T05:52:13.000Z'));

describe('Trust My Travel authentication', () => {
  it('matches the fixed basic authentication vector', () => {
    const authentication = createTmtAuthentication(
      { channels: 2, currencies: 'USD', total: 9999 },
      CHANNEL_SECRET,
      CLOCK,
    );

    expect(authentication).toEqual({
      bookingAuth: '9ab625a3beab3b2014dd7202613778fb8d963a762eff5c95ce430717b9ff288020190812055213',
      verify: [],
    });
  });

  it('sorts extended fields alphabetically and returns their verify list', () => {
    const authentication = createTmtAuthentication(
      {
        channels: 2,
        currencies: 'USD',
        total: 9999,
        reference: 'ORDER-42',
        country: 'GB',
        email: 'john@example.org',
      },
      CHANNEL_SECRET,
      CLOCK,
    );

    expect(authentication).toEqual({
      bookingAuth: 'd9a9366948785146a406bfca117c020aeade273a6968d71abbaa8e9f8890270f20190812055213',
      verify: ['country', 'email', 'reference'],
    });
  });

  it('JSON encodes allocation arrays without reordering their object keys', () => {
    const authentication = createTmtAuthentication(
      {
        channels: 2,
        currencies: 'USD',
        total: 9999,
        allocations: [
          { supplier: 10, amount: 5000 },
          { supplier: 11, amount: 4999 },
        ],
        charge_channel: 2452,
      },
      CHANNEL_SECRET,
      CLOCK,
    );

    expect(authentication).toEqual({
      bookingAuth: 'b4b5f595540c2d715921c24eba594a2dd0ae105a7a5acd18b8edcf9dae5a5f0620190812055213',
      verify: ['allocations', 'charge_channel'],
    });
  });

  it('validates the fixed transaction hash and rejects altered values', () => {
    const hash = '40e07b6b997a08f419dd92ee86d3ab051972c9fc13faf057fef70d34050a080e';

    expect(
      validateTmtTransactionHash({ id: 123, status: 'success', total: 9999, hash }, CHANNEL_SECRET),
    ).toBe(true);
    expect(
      validateTmtTransactionHash({ id: 123, status: 'failed', total: 9999, hash }, CHANNEL_SECRET),
    ).toBe(false);
    expect(
      validateTmtTransactionHash(
        { id: 123, status: 'success', total: 9999, hash: 'invalid' },
        CHANNEL_SECRET,
      ),
    ).toBe(false);
  });

  it('never returns the channel secret', () => {
    const authentication = createTmtAuthentication(
      { channels: 2, currencies: 'USD', total: 9999 },
      CHANNEL_SECRET,
      CLOCK,
    );

    expect(JSON.stringify(authentication)).not.toContain(CHANNEL_SECRET);
  });
});
