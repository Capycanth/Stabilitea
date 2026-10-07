import { Component, computed, effect, inject, input, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { debounce, form, FormField, max, min } from '@angular/forms/signals';
import type { BudgetLineDto, BudgetMonthDto, DeficitPaymentDto } from '@stabilitea/shared';
import { formatCents, MAX_CENTS } from '@stabilitea/shared';
import { errorMessage } from '../shared/api-error';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { Icon } from '../shared/icon';
import { MoneyInput } from '../shared/money-input';
import { MoneyPipe } from '../shared/money-pipe';
import { addMonths, monthLabel, monthName } from '../shared/month';
import { Notifier } from '../shared/notifier';
import { BudgetApi } from './budget-api';
import { BudgetLineRow } from './budget-line-row';

@Component({
  selector: 'app-budget-editor',
  imports: [BudgetLineRow, ConfirmDialog, FormField, Icon, MoneyInput, MoneyPipe],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">{{ label() }}</p>
          <h1>Budget</h1>
        </div>
        @if (budget.hasValue()) {
          @if (closed()) {
            <span class="chip"><app-icon name="lock" [size]="13" />Closed</span>
          } @else {
            <span class="chip chip-green">Open</span>
          }
        }
      </div>

      @if (budget.error() && !budget.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (budget.hasValue()) {
        @let b = budget.value();

        <div class="top">
          <section class="card-deep stack" aria-labelledby="income-title">
            <h2 id="income-title" class="small-title">Planned income</h2>
            @if (closed()) {
              <p class="big money">{{ b.plannedIncomeCents | money }}</p>
            } @else {
              <div class="field">
                <label class="visually-hidden" for="planned-income">Planned income</label>
                <app-money-input inputId="planned-income" describedBy="planned-income-hint" [formField]="incomeForm.plannedIncomeCents" />
                <p id="planned-income-hint" class="hint">Optional target. Saves when you leave the field.</p>
                @for (error of incomeForm.plannedIncomeCents().errors(); track $index) {
                  <p class="field-error" role="alert">{{ error.message }}</p>
                }
              </div>
            }
            <p class="muted small">
              Budgeted <span class="money">{{ totals().limit | money }}</span>
              @if (b.plannedIncomeCents > 0) {
                · <span class="money">{{ b.plannedIncomeCents - totals().limit | money }}</span> unassigned
              }
            </p>
          </section>

          <section class="card-deep stack" aria-labelledby="lifecycle-title">
            <h2 id="lifecycle-title" class="small-title">
              {{ closed() ? monthName(b.month) + ' is closed' : 'Close ' + monthName(b.month) }}
            </h2>
            @if (closed()) {
              <p class="small">Income, spending and fund balances were settled into savings. Reopen to make corrections, then close again.</p>
              <div>
                <button type="button" class="btn" [disabled]="!b.canReopen || busy()" (click)="reopen()" aria-describedby="reopen-hint">
                  <app-icon name="unlock" />Reopen {{ monthName(b.month) }}
                </button>
              </div>
              @if (!b.canReopen) {
                <p id="reopen-hint" class="hint">Reopen {{ nextLabel() }} first. Months reopen newest-first.</p>
              }
            } @else {
              <p class="small">{{ closeExplanation() }}</p>
              <div>
                <button type="button" class="btn btn-primary" [disabled]="!b.canClose || busy()" (click)="close()" aria-describedby="close-hint">
                  <app-icon name="lock" />Close {{ monthName(b.month) }}
                </button>
              </div>
              @if (!b.canClose) {
                <p id="close-hint" class="hint">{{ nextLabel() }} is closed. Reopen it before closing this month.</p>
              }
            }
          </section>
        </div>

        <p class="savings-note" [class.has-deficit]="hasPayableDeficit()">
          <app-icon name="savings" />
          <span>
            Savings available: <strong class="money">{{ b.savingsBalanceCents | money }}</strong>.
            @if (hasPayableDeficit()) {
              Funds that are over budget can be paid down from savings.
            } @else {
              Regular subcategories spend from savings; funds keep their own balance, and a fund deficit can be paid from savings.
            }
          </span>
        </p>

        <div class="table-wrap card">
          <table class="table budget-table">
            <caption class="visually-hidden">Budget lines for {{ label() }}</caption>
            <thead>
              <tr>
                <th scope="col">Subcategory</th>
                <th scope="col">Limit</th>
                <th scope="col" class="end">Balance in</th>
                <th scope="col" class="end">From savings</th>
                <th scope="col" class="end">Spent</th>
                <th scope="col" class="end">Remaining</th>
              </tr>
            </thead>
            @for (group of b.categories; track group.categoryId) {
              <tbody>
                <tr class="group-row">
                  <th scope="rowgroup" colspan="6">
                    <span>{{ group.categoryName }}</span>
                  </th>
                </tr>
                @for (line of group.lines; track line.id) {
                  <tr
                    appBudgetLineRow
                    [line]="line"
                    [month]="b.month"
                    [readonly]="closed()"
                    [savingsBalanceCents]="b.savingsBalanceCents"
                    [busy]="busy()"
                    (updated)="onUpdated($event)"
                    (payDeficit)="payDeficit($event)"
                  ></tr>
                }
              </tbody>
            } @empty {
              <tbody>
                <tr><td colspan="6" class="empty-cell">No expense subcategories to budget. Add some on the Categories page.</td></tr>
              </tbody>
            }
            <tfoot>
              <tr>
                <th scope="row">Total</th>
                <td class="money" data-label="Limit">{{ totals().limit | money }}</td>
                <td class="end money" data-label="Balance in">{{ totals().carryIn | money }}</td>
                <td class="end money" data-label="From savings">{{ totals().deficitPaid | money }}</td>
                <td class="end money" data-label="Spent">{{ totals().spent | money }}</td>
                <td class="end money" data-label="Remaining">{{ totals().remaining | money }}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        @if (b.deficitPayments.length) {
          <section class="card stack" aria-labelledby="deficit-payments-title">
            <div class="row between">
              <h2 id="deficit-payments-title" class="small-title">Deficits paid from savings</h2>
              <p class="money total-paid">{{ b.deficitPaidCents | money }}</p>
            </div>
            <ul class="payments">
              @for (payment of b.deficitPayments; track payment.id) {
                <li>
                  <span>
                    <strong>{{ payment.subcategoryName ?? 'Removed subcategory' }}</strong>
                    <span class="muted"> · {{ payment.categoryName }} · {{ paidOn(payment) }}</span>
                  </span>
                  <span class="money">{{ payment.amountCents | money }}</span>
                  @if (!closed()) {
                    <button type="button" class="btn btn-sm btn-quiet" [disabled]="busy()" (click)="undoPayment(payment)">
                      Undo<span class="visually-hidden"> {{ payment.amountCents | money }} payment for {{ payment.subcategoryName }}</span>
                    </button>
                  }
                </li>
              }
            </ul>
          </section>
        }
      } @else if (budget.isLoading()) {
        <p class="loading" role="status">Loading budget…</p>
      }
    </div>
    <app-confirm-dialog />
  `,
  styles: `
    .top { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; }
    .small-title { font-size: 1.05rem; }
    .small { font-size: 0.9rem; }
    .big { font-size: 1.5rem; font-weight: 650; }
    .table-wrap { padding: 4px 8px; overflow-x: auto; }
    .group-row th { padding-top: 18px; background: transparent; font-family: var(--st-font-heading); font-variation-settings: 'SOFT' 100; font-size: 1.05rem; font-weight: 560; }
    .group-row th span:first-child { margin-right: 10px; }
    tfoot th, tfoot td { font-weight: 650; border-bottom: 0; }
    .empty-cell { text-align: center; color: var(--st-ink-muted); padding: 24px; }
    .savings-note { display: flex; gap: 10px; align-items: center; font-size: 0.9rem; color: var(--st-ink-muted); }
    .savings-note strong { color: var(--st-ink); }
    .between { justify-content: space-between; }
    .total-paid { font-weight: 650; }
    .payments { list-style: none; margin: 0; padding: 0; }
    .payments li { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid var(--st-line); }
    .group-row .chip { font-family: var(--st-font-body); font-variation-settings: normal; }
    @media (max-width: 640px) {
      .table-wrap { padding: 0 4px; }
      .budget-table thead { display: none; }
      .budget-table .group-row th { display: block; padding: 18px 4px 6px; }
      .budget-table tfoot tr { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 12px; padding: 12px 4px; }
      .budget-table tfoot th, .budget-table tfoot td { display: block; padding: 0; text-align: left; }
      .budget-table tfoot th { grid-column: 1 / -1; }
      .budget-table tfoot td::before { content: attr(data-label); display: block; font-size: 0.72rem; font-weight: 600; color: var(--st-ink-muted); text-transform: uppercase; }
    }
  `,
})
export class BudgetEditor {
  private readonly api = inject(BudgetApi);
  private readonly notifier = inject(Notifier);
  private readonly confirm = viewChild.required(ConfirmDialog);

  /** Bound from the `:month` route param. */
  readonly month = input.required<string>();

  protected readonly budget = this.api.budgetResource(this.month);
  protected readonly busy = signal(false);

  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly nextLabel = computed(() => monthLabel(addMonths(this.month(), 1)));
  protected readonly closed = computed(() => this.budget.hasValue() && this.budget.value().status === 'closed');
  protected readonly loadError = computed(() => errorMessage(this.budget.error()));
  protected readonly monthName = monthName;

  protected readonly totals = computed(() => {
    const lines = this.budget.hasValue() ? this.budget.value().categories.flatMap((g) => g.lines) : [];
    return lines.reduce(
      (t, l) => ({
        limit: t.limit + l.limitCents,
        carryIn: t.carryIn + l.carryInCents,
        deficitPaid: t.deficitPaid + l.deficitPaidCents,
        spent: t.spent + l.spentCents,
        remaining: t.remaining + l.remainingCents,
      }),
      { limit: 0, carryIn: 0, deficitPaid: 0, spent: 0, remaining: 0 },
    );
  });

  protected readonly hasPayableDeficit = computed(
    () =>
      this.budget.hasValue() &&
      !this.closed() &&
      this.budget.value().savingsBalanceCents > 0 &&
      this.budget.value().categories.some((g) => g.lines.some((l) => l.fund && l.remainingCents < 0)),
  );

  protected readonly closeExplanation = computed(
    () =>
      `Closing adds this month's income to savings and takes out regular spending and fund contributions. Each fund's balance carries into ${this.nextLabel()}, even if it's negative.`,
  );

  private readonly incomeModel = linkedSignal({
    source: () => (this.budget.hasValue() ? this.budget.value().plannedIncomeCents : 0),
    computation: (plannedIncomeCents) => ({ plannedIncomeCents: plannedIncomeCents as number | null }),
  });

  protected readonly incomeForm = form(this.incomeModel, (f) => {
    debounce(f.plannedIncomeCents, 'blur');
    min(f.plannedIncomeCents, 0, { message: 'Planned income cannot be negative' });
    max(f.plannedIncomeCents, MAX_CENTS, { message: 'Planned income is too large' });
  });

  constructor() {
    // Side effect: persist planned income once the debounced (on blur) value changes.
    effect(() => {
      const value = this.incomeModel().plannedIncomeCents ?? 0;
      const valid = this.incomeForm().valid();
      untracked(() => {
        if (!valid || !this.budget.hasValue() || this.closed()) return;
        if (value !== this.budget.value().plannedIncomeCents) void this.savePlannedIncome(value);
      });
    });
  }

  protected onUpdated(budget: BudgetMonthDto): void {
    this.budget.set(budget);
  }

  protected async payDeficit(line: BudgetLineDto): Promise<void> {
    if (!this.budget.hasValue()) return;
    const deficit = -line.remainingCents;
    const balance = this.budget.value().savingsBalanceCents;
    const paying = Math.min(deficit, balance);
    const partial = paying < deficit;
    const ok = await this.confirm().ask({
      title: `Pay ${line.subcategoryName}'s deficit from savings?`,
      message: partial
        ? `Savings has ${formatCents(balance)}, which covers ${formatCents(paying)} of the ${formatCents(deficit)} deficit. Savings will drop to $0.00 and ${formatCents(deficit - paying)} will still carry forward.`
        : `This moves ${formatCents(paying)} from savings (balance ${formatCents(balance)}) to bring ${line.subcategoryName} back to $0.00. It's recorded on ${this.label()}'s budget and in the yearly report.`,
      confirmLabel: `Pay ${formatCents(paying)}`,
    });
    if (ok) {
      await this.run(
        () => this.api.payDeficit(this.month(), line.id),
        `Paid ${formatCents(paying)} of ${line.subcategoryName}'s deficit from savings.`,
      );
    }
  }

  protected async undoPayment(payment: DeficitPaymentDto): Promise<void> {
    await this.run(
      () => this.api.undoDeficitPayment(this.month(), payment.id),
      `Returned ${formatCents(payment.amountCents)} to savings.`,
    );
  }

  protected paidOn(payment: DeficitPaymentDto): string {
    return new Date(payment.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  protected async close(): Promise<void> {
    const month = this.month();
    const ok = await this.confirm().ask({
      title: `Close ${monthLabel(month)}?`,
      message: `${this.closeExplanation()} You can reopen it later.`,
      confirmLabel: `Close ${monthName(month)}`,
    });
    if (ok) await this.run(() => this.api.close(month), `${monthLabel(month)} closed. Savings and funds updated.`);
  }

  protected async reopen(): Promise<void> {
    const month = this.month();
    const ok = await this.confirm().ask({
      title: `Reopen ${monthLabel(month)}?`,
      message: `This removes ${monthName(month)}'s income, spending and fund entries from savings and resets ${this.nextLabel()}'s fund balances until you close it again. Deficits already paid from savings stay recorded.`,
      confirmLabel: `Reopen ${monthName(month)}`,
    });
    if (ok) await this.run(() => this.api.reopen(month), `${monthLabel(month)} reopened.`);
  }

  private async savePlannedIncome(plannedIncomeCents: number): Promise<void> {
    await this.run(() => this.api.updatePlannedIncome(this.month(), plannedIncomeCents), 'Planned income saved.');
  }

  private async run(action: () => Promise<BudgetMonthDto>, success: string): Promise<void> {
    this.busy.set(true);
    try {
      this.budget.set(await action());
      this.notifier.success(success);
    } catch (error) {
      this.notifier.error(errorMessage(error));
      this.budget.reload();
    } finally {
      this.busy.set(false);
    }
  }
}
