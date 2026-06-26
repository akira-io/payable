import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  toPaymentStatus,
  toRefundResultDTO,
  toRefundStatus,
} from '../src/infrastructure/providers/sisp/sisp-mappers';
import type { SispTransactionRecord } from '../src/infrastructure/providers/sisp/sisp-types';

function record(status: string): SispTransactionRecord {
  return {
    id: 1,
    merchant_ref: 'R-1',
    amount: 1500,
    currency: 'CVE',
    status,
    transaction_id: 'TID',
  };
}

describe('sisp mappers', () => {
  it('maps transaction status to payment status', () => {
    expect(toPaymentStatus('completed')).toBe('succeeded');
    expect(toPaymentStatus('failed')).toBe('failed');
    expect(toPaymentStatus('cancelled')).toBe('canceled');
    expect(toPaymentStatus('unknown')).toBe('pending');
  });

  it('maps transaction status to refund status instead of assuming success', () => {
    expect(toRefundStatus('refunded')).toBe('succeeded');
    expect(toRefundStatus('completed')).toBe('succeeded');
    expect(toRefundStatus('failed')).toBe('failed');
    expect(toRefundStatus('cancelled')).toBe('canceled');
    expect(toRefundStatus('pending')).toBe('pending');
  });

  it('derives the refund DTO status from the processed transaction', () => {
    const amount = Money.of(1500, 'CVE');
    expect(toRefundResultDTO(record('refunded'), amount).status).toBe('succeeded');
    expect(toRefundResultDTO(record('failed'), amount).status).toBe('failed');
    expect(toRefundResultDTO(record('pending'), amount).status).toBe('pending');
  });
});
