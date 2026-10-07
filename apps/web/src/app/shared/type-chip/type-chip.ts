import { Component, input } from '@angular/core';
import type { CategoryType } from '@stabilitea/shared';
import { Icon } from '../icon/icon';

/** "Fund" or "Recurring" chip shown next to a category name. Renders nothing for standard categories. */
@Component({
  selector: 'app-type-chip',
  imports: [Icon],
  template: `
    @switch (type()) {
      @case ('fund') {
        <span class="chip chip-green"><app-icon name="rollover" [size]="12" />Fund</span>
      }
      @case ('recurring') {
        <span class="chip"><app-icon name="calendar" [size]="12" />Recurring</span>
      }
    }
  `,
  styles: `
    /* Set --type-chip-gap where the chip follows text without a flex gap. */
    :host { display: inline; margin-inline-start: var(--type-chip-gap, 0); }
    .chip { font-size: 0.72rem; padding-block: 1px; vertical-align: middle; }
  `,
})
export class TypeChip {
  readonly type = input.required<CategoryType>();
}
