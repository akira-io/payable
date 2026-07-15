import { describe, expect, it } from 'vitest';
import { toPaymentStatus } from '../src/infrastructure/providers/sisp/sisp-mappers';

describe('sisp mappers', () => {
  it('maps transaction status to payment status', () => {
    expect(toPaymentStatus('completed')).toBe('succeeded');
    expect(toPaymentStatus('failed')).toBe('failed');
    expect(toPaymentStatus('cancelled')).toBe('canceled');
    expect(toPaymentStatus('unknown')).toBe('pending');
  });
});
