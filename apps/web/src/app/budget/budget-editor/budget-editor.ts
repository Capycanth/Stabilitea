import { Component, computed, effect, inject, input, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { debounce, form, FormField, max, min } from '@angular/forms/signals';
import type { BudgetLineDto, BudgetMonthDto, DeficitPaymentDto } from '@stabilitea/shared';
import { formatCents, MAX_CENTS } from '@stabilitea/shared';
import { errorMessage } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { Icon } from '../../shared/icon/icon';
import { MoneyInput } from '../../shared/money-input/money-input';
import { MoneyPipe } from '../../shared/money-pipe';
import { addMonths, monthLabel, monthName } from '../../shared/month';
import { Notifier } from '../../shared/notifier';
import { BudgetApi } from '../budget-api';
import { BudgetLineRow } from '../budget-line-row/budget-line-row';

@Component({
  selector: 'app-budget-editor',
  imports: [BudgetLineRow, ConfirmDialog, FormField, Icon, MoneyInput, MoneyPipe],
  templateUrl: './budget-editor.html',
  styleUrl: './budget-editor.scss',
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
    const lines = this.budget.hasValue() ? this.budget.value().groups.flatMap((g) => g.lines) : [];
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
      this.budget.value().groups.some((g) => g.lines.some((l) => l.type === 'fund' && l.remainingCents < 0)),
  );

  protected readonly closeExplanation = computed(
    () =>
      `Closing adds this month's income to savings and takes out standard spending, fund contributions and recurring shares. Each fund's balance and the money stored for each unpaid bill carry into ${this.nextLabel()}; a bill paid this month settles its leftover or shortfall with savings.`,
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
      title: `Pay ${line.categoryName}'s deficit from savings?`,
      message: partial
        ? `Savings has ${formatCents(balance)}, which covers ${formatCents(paying)} of the ${formatCents(deficit)} deficit. Savings will drop to $0.00 and ${formatCents(deficit - paying)} will still carry forward.`
        : `This moves ${formatCents(paying)} from savings (balance ${formatCents(balance)}) to bring ${line.categoryName} back to $0.00. It's recorded on ${this.label()}'s budget and in the yearly report.`,
      confirmLabel: `Pay ${formatCents(paying)}`,
    });
    if (ok) {
      await this.run(
        () => this.api.payDeficit(this.month(), line.id),
        `Paid ${formatCents(paying)} of ${line.categoryName}'s deficit from savings.`,
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
      message: `This removes ${monthName(month)}'s income, spending, fund and recurring entries from savings and resets ${this.nextLabel()}'s fund balances and stored money until you close it again. Deficits already paid from savings stay recorded.`,
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
