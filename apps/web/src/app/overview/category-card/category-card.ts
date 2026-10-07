import { Component, computed, input } from '@angular/core';
import type { CategorySummary } from '@stabilitea/shared';
import { BudgetProgress } from '../../shared/budget-progress/budget-progress';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';

@Component({
  selector: 'app-category-card',
  imports: [BudgetProgress, Icon, MoneyPipe],
  host: { class: 'card' },
  template: `
    <div class="head">
      <h3 [id]="headingId()">{{ category().name }}</h3>
    </div>
    <p class="totals">
      <span class="money spent">{{ category().spentCents | money }}</span>
      <span class="muted"> spent of <span class="money">{{ category().availableCents | money }}</span></span>
    </p>
    <app-budget-progress [spentCents]="category().spentCents" [availableCents]="category().availableCents" />
    @if (category().deficitPaidCents > 0) {
      <p class="paid"><app-icon name="piggy-out" [size]="14" />{{ category().deficitPaidCents | money }} paid from savings</p>
    }

    <ul class="subs list-reset" [attr.aria-labelledby]="headingId()">
      @for (sub of category().subcategories; track sub.id) {
        <li>
          <div class="sub-head">
            <span class="sub-name">
              {{ sub.name }}
              @if (sub.fund) {
                <span class="chip chip-green fund"><app-icon name="rollover" [size]="12" />Fund</span>
              }
            </span>
            <span class="money muted">{{ sub.spentCents | money }}</span>
          </div>
          <app-budget-progress [compact]="true" [spentCents]="sub.spentCents" [availableCents]="sub.limitCents + sub.carryInCents + sub.deficitPaidCents" />
        </li>
      }
    </ul>
  `,
  styles: `
    :host { display: grid; gap: 12px; align-content: start; }
    .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .totals { font-size: 0.9rem; }
    .paid { display: flex; align-items: center; gap: 6px; font-size: 0.82rem; color: var(--st-ink-muted); }
    .spent { font-size: 1.35rem; font-weight: 650; }
    .subs { margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--st-line); display: grid; gap: 12px; }
    .sub-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9rem; font-weight: 500; }
    .sub-name { display: inline-flex; align-items: center; gap: 6px; }
    .fund { font-size: 0.72rem; padding-block: 1px; }
  `,
})
export class CategoryCard {
  readonly category = input.required<CategorySummary>();
  protected readonly headingId = computed(() => `category-card-${this.category().id}`);
}
