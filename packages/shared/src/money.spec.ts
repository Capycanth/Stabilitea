import { describe, expect, it } from 'vitest';
import { centsToDollarString, dollarsToCents, formatCents, MAX_CENTS } from './money.js';

describe('dollarsToCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    ['0.99', 99],
    ['.99', 99],
    ['0', 0],
    ['  7.01 ', 701],
    ['$1,234.56', 123456],
    ['1,000,000', 100000000],
    ['19.', 1900],
  ])('parses %j as %i cents', (input, cents) => {
    expect(dollarsToCents(input)).toBe(cents);
  });

  it.each(['', ' ', '.', 'abc', '-5', '1.234', '1,23', '12..5', '$', '1e3', '0x10'])(
    'rejects %j',
    (input) => {
      expect(dollarsToCents(input)).toBeNull();
    },
  );

  it('avoids floating point drift', () => {
    // 0.29 * 100 === 28.999999999999996 in floating point
    expect(dollarsToCents('0.29')).toBe(29);
    expect(dollarsToCents('1.15')).toBe(115);
  });

  it('accepts finite non-negative numbers', () => {
    expect(dollarsToCents(4.2)).toBe(420);
    expect(dollarsToCents(-1)).toBeNull();
    expect(dollarsToCents(Number.NaN)).toBeNull();
    expect(dollarsToCents(null)).toBeNull();
  });

  it('enforces the maximum', () => {
    expect(dollarsToCents('10000000')).toBe(MAX_CENTS);
    expect(dollarsToCents('10000000.01')).toBeNull();
  });
});

describe('centsToDollarString', () => {
  it.each([
    [0, '0.00'],
    [5, '0.05'],
    [1250, '12.50'],
    [123456, '1234.56'],
    [-705, '-7.05'],
  ])('formats %i as %j', (cents, text) => {
    expect(centsToDollarString(cents)).toBe(text);
  });

  it('round-trips through dollarsToCents', () => {
    for (const cents of [0, 1, 99, 100, 101, 29, 115, 999999]) {
      expect(dollarsToCents(centsToDollarString(cents))).toBe(cents);
    }
  });
});

describe('formatCents', () => {
  it('formats USD with cents', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(-500)).toBe('-$5.00');
  });

  it('can round to whole dollars', () => {
    expect(formatCents(12049, { wholeDollars: true })).toBe('$120');
  });
});
