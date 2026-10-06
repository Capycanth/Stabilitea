import { Component, computed, input } from '@angular/core';
import type { CategorySummary } from '@stabilitea/shared';
import { BudgetProgress } from '../shared/budget-progress';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';

@Component({
  selector: 'app-category-card',
  imports: [BudgetProgress, Icon, MoneyPipe],
  host: { class: 'card' },
  template: `
    <div class="head">
      <h3 [id]="headingId()">{{ category().name }}</h3>
      @if (category().rollover) {
        <span class="chip chip-green"><app-icon name="rollover" [size]="13" />Rolls over</span>
      } @else {
        <span class="chip">Sweeps to savings</span>
      }
    </div>
    <p class="totals">
      <span class="money spent">{{ category().spentCents | money }}</span>
      <span class="muted"> spent of <span class="money">{{ category().availableCents | money }}</span></span>
    </p>
    <app-budget-progress [spentCents]="category().spentCents" [availableCents]="category().availableCents" />
    @if (category().deficitPaidCents > 0) {
      <p class="paid"><app-icon name="piggy-out" [size]="14" />{{ category().deficitPaidCents | money }} paid from savings</p>
    }

    <ul class="subs" [attr.aria-labelledby]="headingId()">
      @for (sub of category().subcategories; track sub.id) {
        <li>
          <div class="sub-head">
            <span>{{ sub.name }}</span>
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
    .subs { list-style: none; margin: 4px 0 0; padding: 12px 0 0; border-top: 1px solid var(--st-line); display: grid; gap: 12px; }
    .sub-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9rem; font-weight: 500; }
  `,
})
export class CategoryCard {
  readonly category = input.required<CategorySummary>();
  protected readonly headingId = computed(() => `category-card-${this.category().id}`);
}
