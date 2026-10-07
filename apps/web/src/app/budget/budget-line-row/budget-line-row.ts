import { Component, computed, effect, inject, input, linkedSignal, output, signal, untracked } from '@angular/core';
import { debounce, form, FormField, max, min, required } from '@angular/forms/signals';
import type { BudgetLineDto, BudgetMonthDto } from '@stabilitea/shared';
import { formatCents, MAX_CENTS } from '@stabilitea/shared';
import { errorMessage } from '../../shared/api-error';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { MoneyPipe } from '../../shared/money-pipe';
import { billText, recurringStatusText } from '../../shared/recurring-text';
import { TypeChip } from '../../shared/type-chip/type-chip';
import { BudgetApi } from '../budget-api';

/** One editable budget line. The limit saves when the input loses focus. */
@Component({
  selector: 'tr[appBudgetLineRow]',
  imports: [FormField, MoneyInput, MoneyPipe, Icon, TypeChip],
  host: { '[class.over]': 'line().remainingCents < 0' },
  templateUrl: './budget-line-row.html',
  styleUrl: './budget-line-row.scss',
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
  /** Only funds carry deficits, so only they can be paid down from savings. */
  protected readonly canPayDeficit = computed(
    () => !this.readonly() && this.line().type === 'fund' && this.line().remainingCents < 0 && this.savingsBalanceCents() > 0,
  );
  protected readonly billText = billText;
  protected readonly statusText = computed(() => {
    const info = this.line().recurring;
    return info ? recurringStatusText(info) : '';
  });
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
        if (valid && limitCents !== null && limitCents !== this.line().limitCents && !this.readonly() && !this.line().recurring) {
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
