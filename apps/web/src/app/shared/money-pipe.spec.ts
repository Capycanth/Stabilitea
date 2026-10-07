import type { Route, UrlSegment } from '@angular/router';
import { MoneyPipe } from './money-pipe';
import { validMonthMatch } from './month';

describe('MoneyPipe', () => {
  const pipe = new MoneyPipe();

  it('formats cents as USD', () => {
    expect(pipe.transform(123456)).toBe('$1,234.56');
    expect(pipe.transform(-705)).toBe('-$7.05');
    expect(pipe.transform(12049, 'whole')).toBe('$120');
  });

  it('renders nothing for missing values', () => {
    expect(pipe.transform(null)).toBe('');
    expect(pipe.transform(undefined)).toBe('');
  });
});

describe('validMonthMatch', () => {
  const match = (path: string) =>
    validMonthMatch({} as Route, [{ path } as UrlSegment], {} as never);

  it('matches real YYYY-MM months only', () => {
    expect(match('2026-09')).toBe(true);
    expect(match('2026-13')).toBe(false);
    expect(match('groups')).toBe(false);
  });
});
