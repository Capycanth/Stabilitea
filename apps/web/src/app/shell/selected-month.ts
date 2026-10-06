import { computed, inject, Service } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { type ActivatedRouteSnapshot, NavigationEnd, Router } from '@angular/router';
import { filter, map, scan } from 'rxjs';
import { addMonths, currentMonth, isValidMonth } from '../shared/month';

interface MonthState {
  month: string;
  inMonthRoute: boolean;
  /** Current path without query or fragment. */
  path: string;
}

function findMonthParam(route: ActivatedRouteSnapshot | null): string | null {
  for (let node = route; node; node = node.firstChild) {
    const month = node.paramMap.get('month');
    if (isValidMonth(month)) return month;
  }
  return null;
}

/**
 * The month selected in the URL, for the shell (month switcher and nav links).
 * Feature routes receive the same value as a `month` input through `withComponentInputBinding()`.
 * On month-less pages (Categories, Savings) it keeps the last month that was visited.
 */
@Service()
export class SelectedMonth {
  private readonly router = inject(Router);

  private readonly state = toSignal(
    this.router.events.pipe(
      filter((event) => event instanceof NavigationEnd),
      map((event) => ({
        month: findMonthParam(this.router.routerState.snapshot.root),
        path: event.urlAfterRedirects.split(/[?#]/)[0] ?? '/',
      })),
      scan<{ month: string | null; path: string }, MonthState>(
        (previous, { month, path }) => ({ month: month ?? previous.month, inMonthRoute: month !== null, path }),
        { month: currentMonth(), inMonthRoute: false, path: '/' },
      ),
    ),
    { initialValue: { month: currentMonth(), inMonthRoute: false, path: '/' } },
  );

  readonly month = computed(() => this.state().month);
  readonly inMonthRoute = computed(() => this.state().inMonthRoute);
  readonly isCurrentMonth = computed(() => this.month() === currentMonth());

  /** URL for the same page in another month, e.g. /2026-10/budget. */
  urlFor(month: string): string {
    const [, first, ...rest] = this.state().path.split('/');
    return isValidMonth(first) ? ['', month, ...rest].join('/') : `/${month}`;
  }

  shift(delta: number): string {
    return this.urlFor(addMonths(this.month(), delta));
  }
}
