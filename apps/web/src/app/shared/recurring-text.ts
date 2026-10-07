import { addMonths, formatCents, monthLabel, type RecurringLineInfo } from '@stabilitea/shared';

/** "$200.00 every 4 months" */
export function billText(billCents: number, billMonths: number): string {
  return `${formatCents(billCents)} ${billMonths === 1 ? 'every month' : `every ${billMonths} months`}`;
}

/** "$200.00 / 4 mo", for tight spaces. */
export function billShortText(billCents: number, billMonths: number): string {
  return `${formatCents(billCents)} / ${billMonths} mo`;
}

/** Where a recurring line stands, in words. */
export function recurringStatusText(info: RecurringLineInfo): string {
  switch (info.status) {
    case 'paid':
      return 'Paid this month';
    case 'due':
      return 'Due this month';
    case 'overdue':
      return `Overdue since ${monthLabel(info.dueMonth)}; stored money is held until it's paid`;
    case 'waiting':
      return `Starts storing in ${monthLabel(addMonths(info.dueMonth, 1 - info.billMonths))}`;
    case 'saving':
      return `Due ${monthLabel(info.dueMonth)}`;
  }
}
