import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TransactionDto, TransactionFilters } from '@stabilitea/shared';
import { BudgetApi } from '../../budget/budget-api';
import { GroupApi } from '../../categories/group-api';
import { errorMessage } from '../../shared/api-error';
import { ConfirmDialog } from '../../shared/confirm-dialog/confirm-dialog';
import { Icon } from '../../shared/icon/icon';
import { MoneyPipe } from '../../shared/money-pipe';
import { monthLabel, monthName } from '../../shared/month';
import { Notifier } from '../../shared/notifier';
import { formatCents } from '@stabilitea/shared';
import { TransactionApi } from '../transaction-api';
import { TransactionFilterBar } from '../transaction-filter-bar/transaction-filter-bar';
import { TransactionForm } from '../transaction-form/transaction-form';

interface DayGroup {
  date: string;
  label: string;
  items: TransactionDto[];
}

const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

@Component({
  selector: 'app-transaction-list',
  imports: [RouterLink, Icon, MoneyPipe, TransactionForm, TransactionFilterBar, ConfirmDialog],
  templateUrl: './transaction-list.html',
  styleUrl: './transaction-list.scss',
})
export class TransactionList {
  private readonly transactionApi = inject(TransactionApi);
  private readonly groupApi = inject(GroupApi);
  private readonly budgetApi = inject(BudgetApi);
  private readonly notifier = inject(Notifier);
  private readonly form = viewChild(TransactionForm);
  private readonly confirm = viewChild.required(ConfirmDialog);

  /** Bound from the `:month` route param. */
  readonly month = input.required<string>();

  protected readonly filters = signal<TransactionFilters>({});
  protected readonly transactions = this.transactionApi.transactionsResource(this.month, this.filters);
  protected readonly groups = this.groupApi.groupsResource();
  protected readonly budget = this.budgetApi.budgetResource(this.month);

  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly isClosed = computed(() => this.budget.hasValue() && this.budget.value().status === 'closed');
  protected readonly hasFilters = computed(() => Object.values(this.filters()).some((v) => v !== undefined));
  protected readonly loadError = computed(() => errorMessage(this.transactions.error()));

  protected readonly days = computed<DayGroup[]>(() => {
    if (!this.transactions.hasValue()) return [];
    const days: DayGroup[] = [];
    for (const tx of this.transactions.value()) {
      let day = days.at(-1);
      if (!day || day.date !== tx.date) {
        day = { date: tx.date, label: dateFormat.format(new Date(`${tx.date}T00:00:00Z`)), items: [] };
        days.push(day);
      }
      day.items.push(tx);
    }
    return days;
  });

  protected readonly totals = computed(() => {
    const list = this.transactions.hasValue() ? this.transactions.value() : [];
    let income = 0;
    let expense = 0;
    for (const tx of list) {
      if (tx.type === 'income') income += tx.amountCents;
      else expense += tx.amountCents;
    }
    return { income, expense, count: list.length };
  });

  protected readonly monthName = monthName;

  protected describe(tx: TransactionDto): string {
    return `${formatCents(tx.amountCents)} ${tx.payee ?? tx.categoryName} on ${tx.date}`;
  }

  protected add(): void {
    this.form()?.open(null);
  }

  protected edit(tx: TransactionDto): void {
    this.form()?.open(tx);
  }

  protected onSaved(tx: TransactionDto): void {
    this.notifier.success(`Saved ${formatCents(tx.amountCents)} ${tx.payee ?? tx.categoryName}.`);
    this.transactions.reload();
  }

  protected async remove(tx: TransactionDto): Promise<void> {
    const ok = await this.confirm().ask({
      title: 'Delete transaction?',
      message: `Delete ${this.describe(tx)}? This can't be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await this.transactionApi.remove(tx.id);
      this.notifier.success('Transaction deleted.');
      this.transactions.reload();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    }
  }
}
