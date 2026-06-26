import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import {
  sispAmount,
  sispDecimal,
  sispMoney,
} from '../src/infrastructure/providers/sisp/sisp-amounts';

describe('sisp amounts', () => {
  it('converts payable minor units to SISP major units', () => {
    expect(sispAmount(Money.of(150000, 'CVE'))).toBe(1500);
    expect(sispAmount(Money.of(1550, 'CVE'))).toBe(15.5);
  });

  it('derives the major amount from the precise decimal string', () => {
    expect(sispAmount(Money.of(1559, 'CVE'))).toBe(15.59);
    expect(sispAmount(Money.of(5, 'CVE'))).toBe(0.05);
    for (const minor of [1, 7, 29, 1559, 99999]) {
      const money = Money.of(minor, 'CVE');
      expect(sispAmount(money)).toBe(Number(sispDecimal(money)));
    }
  });

  it('formats a precise decimal string without floating-point drift', () => {
    expect(sispDecimal(Money.of(150000, 'CVE'))).toBe('1500.00');
    expect(sispDecimal(Money.of(1550, 'CVE'))).toBe('15.50');
    expect(sispDecimal(Money.of(1559, 'CVE'))).toBe('15.59');
    expect(sispDecimal(Money.of(5, 'CVE'))).toBe('0.05');
    expect(sispMoney(Number(sispDecimal(Money.of(123456, 'CVE'))), 'CVE').amount()).toBe(123456);
  });

  it('converts SISP major units back to payable minor units', () => {
    expect(sispMoney(1500, 'CVE').amount()).toBe(150000);
    expect(sispMoney(15.5, 'CVE').amount()).toBe(1550);
  });

  it('round-trips without precision drift', () => {
    const money = Money.of(123456, 'CVE');
    expect(sispMoney(sispAmount(money), 'CVE').amount()).toBe(123456);
  });
});
