/** Money helpers. Amounts are stored and transmitted as integer cents (USD). */

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usdWhole = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

/** Largest amount accepted anywhere in the app: $10,000,000.00. */
export const MAX_CENTS = 1_000_000_000;

/**
 * Parses a user-entered dollar amount into integer cents.
 * Accepts "12", "12.5", "12.50", ".99", "$1,234.56" and surrounding whitespace.
 * Returns null for empty, negative, malformed, more than 2 decimals, or out-of-range input.
 */
export function dollarsToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    input = String(input);
  }
  const cleaned = input.trim().replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(cleaned);
  if (!match || cleaned === '' || cleaned === '.') return null;
  const whole = match[1] === '' ? 0 : Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(2, '0');
  const cents = whole * 100 + Number(fraction);
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return cents;
}

/** Plain editable dollar string without symbol or grouping: 1234.5 → "1234.50", 0 → "0.00". */
export function centsToDollarString(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** Display formatting: 123456 → "$1,234.56"; -500 → "-$5.00". */
export function formatCents(cents: number, options: { wholeDollars?: boolean } = {}): string {
  const formatter = options.wholeDollars ? usdWhole : usd;
  return formatter.format(cents / 100);
}
