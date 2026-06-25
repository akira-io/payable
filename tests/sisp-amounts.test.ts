import { describe, expect, it } from 'vitest';
import { Money } from '../src/domain/value-objects/money';
import { sispAmount, sispMoney } from '../src/infrastructure/providers/sisp/sisp-amounts';

describe('sisp amounts', () => {
  it('converts payable minor units to SISP major units', () => {
    expect(sispAmount(Money.of(150000, 'CVE'))).toBe(1500);
    expect(sispAmount(Money.of(1550, 'CVE'))).toBe(15.5);
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
