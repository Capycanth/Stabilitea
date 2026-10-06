import { Component, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { debounce, form, FormField, max, min, required } from '@angular/forms/signals';
import type { BudgetLineDto, BudgetMonthDto } from '@stabilitea/shared';
import { formatCents, MAX_CENTS } from '@stabilitea/shared';
import { errorMessage } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyInput } from '../shared/money-input';
import { MoneyPipe } from '../shared/money-pipe';
import { BudgetApi } from './budget-api';

/** One editable budget line. The limit saves when the input loses focus. */
@Component({
  selector: 'tr[appBudgetLineRow]',
  imports: [FormField, MoneyInput, MoneyPipe, Icon],
  host: { '[class.over]': 'line().remainingCents < 0' },
  template: `
    <th scope="row" class="name">{{ line().subcategoryName }}</th>
    <td class="limit" data-label="Limit">
      @if (readonly()) {
        <span class="money">{{ line().limitCents | money }}</span>
      } @else {
        <app-money-input
          [inputId]="inputId()"
          [ariaLabel]="'Limit for ' + line().subcategoryName"
          [describedBy]="errorId()"
          [formField]="lineForm.limitCents"
        />
        <div [id]="errorId()">
          @if (lineForm.limitCents().errors()[0]; as error) {
            <p class="field-error" role="alert">{{ error.message }}</p>
          }
          @if (saveError(); as message) {
            <p class="field-error" role="alert">{{ message }}</p>
          }
        </div>
      }
    </td>
    <td class="end money" data-label="Carry-in" [class.deficit]="line().carryInCents < 0">
      {{ line().carryInCents | money }}
      @if (line().carryInCents < 0) {
        <span class="visually-hidden">(deficit carried from last month)</span>
      }
    </td>
    <td class="end money" data-label="From savings">
      @if (line().deficitPaidCents > 0) {
        {{ line().deficitPaidCents | money }}
      } @else {
        <span class="muted" aria-label="None">—</span>
      }
    </td>
    <td class="end money" data-label="Spent">{{ line().spentCents | money }}</td>
    <td class="end money remaining" data-label="Remaining">
      @if (line().remainingCents < 0) {
        <span class="over-label"><app-icon name="warning" [size]="14" />Over by {{ -line().remainingCents | money }}</span>
        @if (canPayDeficit()) {
          <button type="button" class="btn btn-sm pay" [disabled]="busy()" (click)="payDeficit.emit(line())">
            <app-icon name="piggy-out" [size]="15" />Pay from savings
            <span class="visually-hidden">for {{ line().subcategoryName }}</span>
          </button>
        }
      } @else {
        {{ line().remainingCents | money }}
      }
      @if (saving()) {
        <span class="visually-hidden" role="status">Saving</span>
      }
    </td>
  `,
  styles: `
    :host(.over) .remaining { color: var(--st-orange); font-weight: 600; }
    .name { font-weight: 500; }
    .limit { width: 160px; }
    .over-label { display: inline-flex; align-items: center; gap: 4px; }
    .deficit { color: var(--st-orange); }
    .remaining .over-label { justify-content: flex-end; }
    .pay { display: flex; margin: 6px 0 0 auto; font-weight: 600; color: var(--st-ink); }
    @media (max-width: 640px) {
      :host { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; padding: 12px 4px; border-bottom: 1px solid var(--st-line); }
      th, td { display: block; border: 0; padding: 0; text-align: left; }
      .name, .limit { grid-column: 1 / -1; width: auto; }
      .remaining .over-label { justify-content: flex-start; }
      .pay { margin-left: 0; }
      td.end[data-label]::before { content: attr(data-label); display: block; font-size: 0.72rem; font-weight: 600; color: var(--st-ink-muted); text-transform: uppercase; letter-spacing: 0.03em; }
    }
  `,
})
export class BudgetLineRow {
  private readonly api = inject(BudgetApi);

  readonly line = input.required<BudgetLineDto>();
  readonly month = input.required<string>();
  readonly readonly = input(false);
  /** Savings available for covering deficits. */
  readonly savingsBalanceCents = input(0);
  /** True while a month-level action (e.g. a deficit payment) is running. */
  readonly busy = input(false);
  readonly updated = output<BudgetMonthDto>();
  readonly payDeficit = output<BudgetLineDto>();

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  /** Only rollover lines carry deficits, so only they can be paid down from savings. */
  protected readonly canPayDeficit = computed(
    () => !this.readonly() && this.line().rollover && this.line().remainingCents < 0 && this.savingsBalanceCents() > 0,
  );
  protected readonly inputId = computed(() => `limit-${this.line().id}`);
  protected readonly errorId = computed(() => `limit-${this.line().id}-errors`);

  /** Resets only when the server's limit changes, so a reload never clobbers typing elsewhere. */
  private readonly model = linkedSignal({
    source: () => this.line().limitCents,
    computation: (limitCents) => ({ limitCents: limitCents as number | null }),
  });

  protected readonly lineForm = form(this.model, (f) => {
    debounce(f.limitCents, 'blur');
    required(f.limitCents, { message: 'Enter a limit (0 for none)' });
    min(f.limitCents, 0, { message: 'Limit cannot be negative' });
    max(f.limitCents, MAX_CENTS, { message: 'Limit is too large' });
  });

  constructor() {
    // Side effect: persist the limit after the debounced (on blur) model value changes.
    effect(() => {
      const limitCents = this.model().limitCents;
      const valid = this.lineForm().valid();
      untracked(() => {
        if (valid && limitCents !== null && limitCents !== this.line().limitCents && !this.readonly()) {
          void this.save(limitCents);
        }
      });
    });
  }

  private async save(limitCents: number): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const budget = await this.api.updateLineLimit(this.month(), this.line().id, limitCents);
      this.updated.emit(budget);
    } catch (error) {
      this.saveError.set(`Couldn't save ${formatCents(limitCents)}: ${errorMessage(error)}`);
    } finally {
      this.saving.set(false);
    }
  }
}
