import { Component, computed, input } from '@angular/core';
import { budgetStatus } from './budget-status';
import { Icon } from './icon';

/** Progress bar with a text equivalent. Color is never the only signal. */
@Component({
  selector: 'app-budget-progress',
  imports: [Icon],
  host: { '[class]': '"tone-" + status().tone', '[class.compact]': 'compact()' },
  template: `
    <div class="track" aria-hidden="true">
      <div class="fill" [style.width.%]="status().percent"></div>
    </div>
    <p class="label">
      @if (status().tone === 'over') {
        <app-icon name="warning" [size]="15" />
      }
      <span class="money">{{ status().label }}</span>
    </p>
  `,
  styles: `
    :host { display: grid; gap: 6px; }
    .track { height: 10px; border-radius: 999px; background: var(--st-ivory-deep); border: 1px solid var(--st-line); overflow: hidden; }
    :host(.compact) .track { height: 6px; }
    .fill { height: 100%; border-radius: inherit; background: var(--st-green-soft); transition: width 240ms ease; }
    :host(.tone-near) .fill, :host(.tone-over) .fill { background: var(--st-orange-soft); }
    .label { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; color: var(--st-ink-muted); }
    :host(.compact) .label { font-size: 0.8rem; }
    :host(.tone-over) .label { color: var(--st-orange); font-weight: 600; }
  `,
})
export class BudgetProgress {
  readonly spentCents = input.required<number>();
  readonly availableCents = input.required<number>();
  readonly compact = input(false);

  protected readonly status = computed(() => budgetStatus(this.spentCents(), this.availableCents()));
}
