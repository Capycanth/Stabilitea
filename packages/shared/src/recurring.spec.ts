import { describe, expect, it } from 'vitest';
import { addMonths } from './month.js';
import { monthsBetween, nextDueAfterPayment, recurringInstallment, recurringStatus } from './recurring.js';

/** Simulates a cycle from `start` through `due`, storing each month's share. */
function schedule(billCents: number, billMonths: number, due: string, start: string, stored = 0): number[] {
  const shares: number[] = [];
  for (let month = start; monthsBetween(month, due) >= 0; month = addMonths(month, 1)) {
    const share = recurringInstallment(billCents, billMonths, due, month, stored);
    shares.push(share);
    stored += share;
  }
  return shares;
}

describe('recurring bills', () => {
  it('counts months between keys', () => {
    expect(monthsBetween('2026-09', '2026-12')).toBe(3);
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(monthsBetween('2026-12', '2026-09')).toBe(-3);
  });

  it('splits an even bill into equal monthly shares', () => {
    expect(schedule(20_000, 4, '2026-12', '2026-09')).toEqual([5_000, 5_000, 5_000, 5_000]);
  });

  it('puts leftover cents in the earliest months and adds up to the bill exactly', () => {
    expect(schedule(38_733, 2, '2026-12', '2026-11')).toEqual([19_367, 19_366]);
    expect(schedule(10_000, 3, '2026-12', '2026-10')).toEqual([3_334, 3_333, 3_333]);
    const shares = schedule(99_999, 7, '2027-06', '2026-12');
    expect(shares.reduce((a, b) => a + b, 0)).toBe(99_999);
    expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
  });

  it('stores nothing before the cycle starts', () => {
    expect(schedule(20_000, 4, '2026-12', '2026-06')).toEqual([0, 0, 0, 5_000, 5_000, 5_000, 5_000]);
  });

  it('spreads the whole bill over the months left when starting mid-cycle', () => {
    expect(schedule(20_000, 4, '2026-12', '2026-11')).toEqual([10_000, 10_000]);
  });

  it('spreads what is still needed after the bill amount changes', () => {
    // $100 already stored, bill rises to $240 with two months left.
    expect(schedule(24_000, 4, '2026-12', '2026-11', 10_000)).toEqual([7_000, 7_000]);
  });

  it('stores nothing once enough is stored or the bill is overdue', () => {
    expect(recurringInstallment(20_000, 4, '2026-12', '2026-11', 20_000)).toBe(0);
    expect(recurringInstallment(20_000, 4, '2026-12', '2027-01', 15_000)).toBe(0);
  });

  it('makes up a negative starting balance', () => {
    expect(schedule(20_000, 2, '2026-12', '2026-11', -2_000)).toEqual([11_000, 11_000]);
  });

  it('moves the due month one cycle on after a payment, skipping cycles already past', () => {
    expect(nextDueAfterPayment('2026-12', 4, '2026-12')).toBe('2027-04');
    expect(nextDueAfterPayment('2026-12', 4, '2027-01')).toBe('2027-04');
    expect(nextDueAfterPayment('2026-12', 4, '2026-11')).toBe('2027-04');
    expect(nextDueAfterPayment('2026-12', 1, '2027-02')).toBe('2027-02');
  });

  it('describes where a line stands', () => {
    expect(recurringStatus(4, '2026-12', '2026-07', 0)).toBe('waiting');
    expect(recurringStatus(4, '2026-12', '2026-09', 0)).toBe('saving');
    expect(recurringStatus(4, '2026-12', '2026-12', 0)).toBe('due');
    expect(recurringStatus(4, '2026-12', '2027-01', 0)).toBe('overdue');
    expect(recurringStatus(4, '2026-12', '2026-12', 19_500)).toBe('paid');
  });
});
