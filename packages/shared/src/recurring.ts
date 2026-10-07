/**
 * Recurring bills: a bill of `billCents` due every `billMonths` months. Each month of the cycle stores a share of
 * the bill (taken out of savings at close), so the bill is fully stored by its due month. Pure helpers shared by the
 * API (close math) and the web app (previews).
 */
import { addMonths } from './month.js';

export const MAX_BILL_MONTHS = 120;

/** Whole months from `from` to `to` ('2026-09' → '2026-12' is 3). Negative when `to` is earlier. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm] = from.split('-').map(Number) as [number, number];
  const [ty, tm] = to.split('-').map(Number) as [number, number];
  return (ty - fy) * 12 + (tm - fm);
}

/**
 * This month's share of the bill. The amount still needed (bill − stored so far) is split evenly over the months left
 * through the due month, rounding up, so leftover cents land in the earliest months and the shares add up to the bill
 * exactly: $387.33 over 2 months is $193.67 then $193.66.
 *
 * - Starting mid-cycle, or after the bill amount changes, the rest is spread over the months left.
 * - Before the cycle starts (more than `billMonths` months before the due month) nothing is stored.
 * - After the due month (the bill is overdue) nothing more is stored; the stored money is held until it's paid.
 */
export function recurringInstallment(
  billCents: number,
  billMonths: number,
  dueMonth: string,
  month: string,
  storedCents: number,
): number {
  const monthsLeft = monthsBetween(month, dueMonth) + 1;
  if (monthsLeft <= 0 || monthsLeft > billMonths) return 0;
  const needed = billCents - storedCents;
  if (needed <= 0) return 0;
  return Math.ceil(needed / monthsLeft);
}

/**
 * The cycle after a payment recorded in `paidMonth`: the next due month is one cycle after the current one, moved on
 * by further cycles if it would still fall before the payment month.
 */
export function nextDueAfterPayment(dueMonth: string, billMonths: number, paidMonth: string): string {
  let next = addMonths(dueMonth, billMonths);
  while (monthsBetween(paidMonth, next) < 0) next = addMonths(next, billMonths);
  return next;
}

export type RecurringStatus = 'waiting' | 'saving' | 'due' | 'overdue' | 'paid';

/**
 * Where a recurring line stands in its month: `paid` when a payment was recorded, otherwise `waiting` (cycle not
 * started), `saving` (storing toward the due month), `due` (due this month) or `overdue` (past due, money held).
 */
export function recurringStatus(billMonths: number, dueMonth: string, month: string, spentCents: number): RecurringStatus {
  if (spentCents > 0) return 'paid';
  const monthsLeft = monthsBetween(month, dueMonth) + 1;
  if (monthsLeft <= 0) return 'overdue';
  if (monthsLeft === 1) return 'due';
  return monthsLeft > billMonths ? 'waiting' : 'saving';
}
