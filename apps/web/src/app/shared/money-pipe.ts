import { Pipe, type PipeTransform } from '@angular/core';
import { formatCents } from '@stabilitea/shared';

/** Formats integer cents as USD: `{{ 123456 | money }}` → "$1,234.56". */
@Pipe({ name: 'money' })
export class MoneyPipe implements PipeTransform {
  transform(cents: number | null | undefined, style: 'cents' | 'whole' = 'cents'): string {
    if (cents === null || cents === undefined) return '';
    return formatCents(cents, { wholeDollars: style === 'whole' });
  }
}
