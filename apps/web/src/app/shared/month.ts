import type { CanMatchFn } from '@angular/router';
import { isValidMonth } from '@stabilitea/shared';

export { addMonths, currentMonth, isValidMonth, monthLabel, monthName, today } from '@stabilitea/shared';

/** Route guard: only match `:month` when the segment is a real 'YYYY-MM' month. */
export const validMonthMatch: CanMatchFn = (_route, segments) => isValidMonth(segments[0]?.path);
