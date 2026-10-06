/** Helpers for 'YYYY-MM' month keys and 'YYYY-MM-DD' dates. Pure, timezone-safe (no Date parsing of keys). */

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})$/;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export function isValidMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

export function isValidDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const day = Number(m[3]);
  return day >= 1 && day <= daysInMonth(`${m[1]}-${m[2]}`);
}

function parts(month: string): { year: number; monthIndex: number } {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`Invalid month key: ${month}`);
  return { year: Number(m[1]), monthIndex: Number(m[2]) - 1 };
}

function key(year: number, monthIndex: number): string {
  return `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}`;
}

/** Month key for a local Date (defaults to now). */
export function currentMonth(now: Date = new Date()): string {
  return key(now.getFullYear(), now.getMonth());
}

/** Local 'YYYY-MM-DD' for a Date (defaults to now). */
export function today(now: Date = new Date()): string {
  return `${currentMonth(now)}-${String(now.getDate()).padStart(2, '0')}`;
}

export function addMonths(month: string, delta: number): string {
  const { year, monthIndex } = parts(month);
  const total = year * 12 + monthIndex + delta;
  return key(Math.floor(total / 12), ((total % 12) + 12) % 12);
}

export function daysInMonth(month: string): number {
  const { year, monthIndex } = parts(month);
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** 'YYYY-MM' part of a 'YYYY-MM-DD' date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** Inclusive first and last day of a month as 'YYYY-MM-DD'. */
export function monthBounds(month: string): { first: string; last: string } {
  parts(month);
  return { first: `${month}-01`, last: `${month}-${String(daysInMonth(month)).padStart(2, '0')}` };
}

/** 'August' */
export function monthName(month: string): string {
  return MONTH_NAMES[parts(month).monthIndex];
}

/** 'August 2026' */
export function monthLabel(month: string): string {
  const { year, monthIndex } = parts(month);
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}
