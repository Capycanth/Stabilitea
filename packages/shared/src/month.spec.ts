import { describe, expect, it } from 'vitest';
import {
  addMonths,
  currentMonth,
  daysInMonth,
  isValidDate,
  isValidMonth,
  monthBounds,
  monthLabel,
  monthName,
  monthOf,
  today,
} from './month.js';

describe('month helpers', () => {
  it('validates month keys', () => {
    expect(isValidMonth('2026-09')).toBe(true);
    expect(isValidMonth('2026-13')).toBe(false);
    expect(isValidMonth('2026-9')).toBe(false);
    expect(isValidMonth('overview')).toBe(false);
    expect(isValidMonth(202609)).toBe(false);
  });

  it('validates dates including month length and leap years', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-04-31')).toBe(false);
    expect(isValidDate('2026-04-00')).toBe(false);
  });

  it('adds months across year boundaries', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-05', -17)).toBe('2024-12');
    expect(addMonths('2026-05', 0)).toBe('2026-05');
  });

  it('derives current month and day from a local date', () => {
    const d = new Date(2026, 8, 7, 23, 30);
    expect(currentMonth(d)).toBe('2026-09');
    expect(today(d)).toBe('2026-09-07');
  });

  it('computes bounds, names and labels', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(monthBounds('2026-09')).toEqual({ first: '2026-09-01', last: '2026-09-30' });
    expect(monthOf('2026-08-15')).toBe('2026-08');
    expect(monthName('2026-08')).toBe('August');
    expect(monthLabel('2026-08')).toBe('August 2026');
  });
});
