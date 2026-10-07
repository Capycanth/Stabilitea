import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Icon } from '../../shared/icon/icon';
import { addMonths, currentMonth, monthLabel } from '../../shared/month';
import { SelectedMonth } from '../selected-month';

@Component({
  selector: 'app-month-switcher',
  imports: [RouterLink, Icon],
  host: { role: 'group', 'aria-label': 'Month' },
  template: `
    <a class="btn btn-icon btn-quiet" [routerLink]="previousUrl()">
      <app-icon name="chevron-left" />
      <span class="visually-hidden">Previous month, {{ previousLabel() }}</span>
    </a>
    <p class="label" aria-live="polite">{{ label() }}</p>
    <a class="btn btn-icon btn-quiet" [routerLink]="nextUrl()">
      <app-icon name="chevron-right" />
      <span class="visually-hidden">Next month, {{ nextLabel() }}</span>
    </a>
    @if (!selected.isCurrentMonth()) {
      <a class="btn btn-sm" [routerLink]="currentUrl()">This month</a>
    }
  `,
  styles: `
    :host { display: flex; align-items: center; gap: 4px; }
    .label { min-width: 11.5ch; text-align: center; font-family: var(--st-font-heading); font-variation-settings: 'SOFT' 100; font-size: 1.1rem; font-weight: 560; }
    a.btn-sm { margin-left: 8px; }
  `,
})
export class MonthSwitcher {
  protected readonly selected = inject(SelectedMonth);

  protected readonly label = computed(() => monthLabel(this.selected.month()));
  protected readonly previousLabel = computed(() => monthLabel(addMonths(this.selected.month(), -1)));
  protected readonly nextLabel = computed(() => monthLabel(addMonths(this.selected.month(), 1)));
  protected readonly previousUrl = computed(() => this.selected.shift(-1));
  protected readonly nextUrl = computed(() => this.selected.shift(1));
  protected readonly currentUrl = computed(() => this.selected.urlFor(currentMonth()));
}
