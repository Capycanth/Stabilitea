import { Component, computed, input } from '@angular/core';
import type { GroupSummary } from '@stabilitea/shared';
import { BudgetProgress } from '../../shared/budget-progress/budget-progress';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { TypeChip } from '../../shared/type-chip/type-chip';

@Component({
  selector: 'app-group-card',
  imports: [BudgetProgress, Icon, MoneyPipe, TypeChip],
  host: { class: 'card' },
  template: `
    <div class="head">
      <h3 [id]="headingId()">{{ group().name }}</h3>
    </div>
    <p class="totals">
      <span class="money spent">{{ group().spentCents | money }}</span>
      <span class="muted"> spent of <span class="money">{{ group().availableCents | money }}</span></span>
    </p>
    <app-budget-progress [spentCents]="group().spentCents" [availableCents]="group().availableCents" />
    @if (group().deficitPaidCents > 0) {
      <p class="paid"><app-icon name="piggy-out" [size]="14" />{{ group().deficitPaidCents | money }} paid from savings</p>
    }

    <ul class="categories list-reset" [attr.aria-labelledby]="headingId()">
      @for (category of group().categories; track category.id) {
        <li>
          <div class="category-head">
            <span class="category-name">
              {{ category.name }}
              <app-type-chip [type]="category.type" />
            </span>
            <span class="money muted">{{ category.spentCents | money }}</span>
          </div>
          <app-budget-progress [compact]="true" [spentCents]="category.spentCents" [availableCents]="category.limitCents + category.carryInCents + category.deficitPaidCents" />
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
    .categories { margin-top: 4px; padding-top: 12px; border-top: 1px solid var(--st-line); display: grid; gap: 12px; }
    .category-head { display: flex; justify-content: space-between; gap: 8px; font-size: 0.9rem; font-weight: 500; }
    .category-name { display: inline-flex; align-items: center; gap: 6px; }
  `,
})
export class GroupCard {
  readonly group = input.required<GroupSummary>();
  protected readonly headingId = computed(() => `group-card-${this.group().id}`);
}
