import { describe, expect, it } from 'vitest';
import {
  toRevolutBusinessIssuingCardDTO,
  toRevolutBusinessIssuingTransactionDTO,
} from '../src/infrastructure/providers/revolut/revolut-business-card-mappers';

describe('Revolut Business Issuing mappers', () => {
  it('maps card state and expiry without sensitive details', () => {
    const mapped = toRevolutBusinessIssuingCardDTO({
      id: 'card-1',
      holder_id: 'member-1',
      created_at: '2026-07-01T10:00:00Z',
      virtual: false,
      last_digits: '2671',
      expiry: '09/2030',
      state: 'locked',
      product: { scheme: 'Mastercard' },
    });

    expect(mapped).toEqual({
      providerCardId: 'card-1',
      providerCardholderId: 'member-1',
      form: 'physical',
      status: 'blocked',
      brand: 'Mastercard',
      lastFour: '2671',
      expiryMonth: 9,
      expiryYear: 2030,
      createdAt: new Date('2026-07-01T10:00:00Z'),
    });
    expect(JSON.stringify(mapped)).not.toMatch(/pan|cvv|pin|sensitive/i);
  });

  it('maps unknown card state and malformed expiry conservatively', () => {
    const mapped = toRevolutBusinessIssuingCardDTO({
      id: 'card-1',
      virtual: true,
      last_digits: '2671',
      expiry: 'future',
      state: 'future_state',
    });

    expect(mapped.status).toBe('unknown');
    expect(mapped.expiryMonth).toBeNull();
    expect(mapped.expiryYear).toBeNull();
  });

  it('rejects card transactions without a card or monetary leg', () => {
    expect(() =>
      toRevolutBusinessIssuingTransactionDTO({
        id: 'transaction-1',
        type: 'card_payment',
        state: 'completed',
        legs: [],
      }),
    ).toThrowError(/card and monetary leg/);
  });
});
