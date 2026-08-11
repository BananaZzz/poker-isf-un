import { describe, it, expect } from 'vitest';
import { formatCurrency, parseCurrencyToCents, nextBlindLevel } from '../src/lib/money';

describe('money', () => {
  it('formats integer cents', () => {
    expect(formatCurrency(0)).toBe('€0.00');
    expect(formatCurrency(10)).toBe('€0.10');
    expect(formatCurrency(2000)).toBe('€20.00');
    expect(formatCurrency(-475)).toBe('−€4.75');
  });
  it('formats with sign', () => {
    expect(formatCurrency(420, { showSign: true })).toBe('+€4.20');
    expect(formatCurrency(-420, { showSign: true })).toBe('−€4.20');
  });
  it('parses back', () => {
    expect(parseCurrencyToCents('20.00')).toBe(2000);
    expect(parseCurrencyToCents('€0.10')).toBe(10);
    expect(parseCurrencyToCents('-4.75')).toBe(-475);
    expect(parseCurrencyToCents('abc')).toBeNull();
  });
});

describe('blind progression', () => {
  it('rounds small levels to 5c', () => {
    expect(nextBlindLevel(10, 1.5).smallBlind).toBe(15);
    expect(nextBlindLevel(15, 1.5).smallBlind).toBe(25); // 22.5 rounds to 25 at 5c cadence -- ensure monotonic
  });
  it('rounds large levels to 10c', () => {
    expect(nextBlindLevel(100, 1.5).smallBlind).toBe(150);
    expect(nextBlindLevel(150, 1.5).smallBlind).toBe(230); // 225 → 230
  });
  it('always monotonically increases', () => {
    let sb = 10;
    for (let i = 0; i < 6; i++) {
      const nxt = nextBlindLevel(sb, 1.5);
      expect(nxt.smallBlind).toBeGreaterThan(sb);
      expect(nxt.bigBlind).toBe(nxt.smallBlind * 2);
      sb = nxt.smallBlind;
    }
  });
  it('handles 2× multiplier', () => {
    expect(nextBlindLevel(10, 2).smallBlind).toBe(20);
    expect(nextBlindLevel(50, 2).smallBlind).toBe(100);
  });
});
