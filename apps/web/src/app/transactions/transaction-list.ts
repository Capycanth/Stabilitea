import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import type { TransactionDto, TransactionFilters } from '@stabilitea/shared';
import { BudgetApi } from '../budget/budget-api';
import { CategoryApi } from '../categories/category-api';
import { errorMessage } from '../shared/api-error';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';
import { monthLabel, monthName } from '../shared/month';
import { Notifier } from '../shared/notifier';
import { formatCents } from '@stabilitea/shared';
import { TransactionApi } from './transaction-api';
import { TransactionFilterBar } from './transaction-filter-bar';
import { TransactionForm } from './transaction-form';

interface DateGroup {
  date: string;
  label: string;
  items: TransactionDto[];
}

const dateFormat = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

@Component({
  selector: 'app-transaction-list',
  imports: [RouterLink, Icon, MoneyPipe, TransactionForm, TransactionFilterBar, ConfirmDialog],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">{{ label() }}</p>
          <h1>Transactions</h1>
        </div>
        @if (!isClosed()) {
          <button type="button" class="btn btn-primary" [disabled]="!categories.hasValue()" (click)="add()">
            <app-icon name="plus" />
            Add transaction
          </button>
        }
      </div>

      @if (isClosed()) {
        <p class="card-deep notice">
          <app-icon name="lock" />
          <span>
            {{ label() }} is closed, so transactions are read-only.
            <a [routerLink]="['/', month(), 'budget']">Reopen it on the Budget page</a> to make corrections.
          </span>
        </p>
      }

      @if (categories.hasValue()) {
        <app-transaction-filter-bar [categories]="categories.value()" [(filters)]="filters" />
      }

      <section class="totals" aria-label="Totals for the listed transactions">
        <p><span class="muted">Income</span> <span class="money income">{{ totals().income | money }}</span></p>
        <p><span class="muted">Expenses</span> <span class="money">{{ totals().expense | money }}</span></p>
        <p><span class="muted">Count</span> <span class="num">{{ totals().count }}</span></p>
      </section>

      @if (transactions.error() && !transactions.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (transactions.hasValue()) {
        <div class="groups" [attr.aria-busy]="transactions.isLoading()">
          @for (group of groups(); track group.date) {
            <section class="group" [attr.aria-labelledby]="'day-' + group.date">
              <h2 class="day" [id]="'day-' + group.date">{{ group.label }}</h2>
              <ul class="items">
                @for (tx of group.items; track tx.id) {
                  <li class="item">
                    <div class="who">
                      <p class="payee">{{ tx.payee || tx.subcategoryName }}</p>
                      <p class="meta muted">
                        {{ tx.categoryName }} › {{ tx.subcategoryName }}
                        @if (tx.note) {
                          <span class="note"> · {{ tx.note }}</span>
                        }
                      </p>
                    </div>
                    <p class="amount money" [class.income]="tx.type === 'income'">
                      <span class="visually-hidden">{{ tx.type === 'income' ? 'Income' : 'Expense' }}</span>
                      {{ tx.type === 'income' ? '+' : '−' }}{{ tx.amountCents | money }}
                    </p>
                    @if (!isClosed()) {
                      <div class="actions">
                        <button type="button" class="btn btn-quiet btn-sm btn-icon" (click)="edit(tx)">
                          <app-icon name="edit" [size]="16" />
                          <span class="visually-hidden">Edit {{ describe(tx) }}</span>
                        </button>
                        <button type="button" class="btn btn-quiet btn-sm btn-icon" (click)="remove(tx)">
                          <app-icon name="trash" [size]="16" />
                          <span class="visually-hidden">Delete {{ describe(tx) }}</span>
                        </button>
                      </div>
                    }
                  </li>
                }
              </ul>
            </section>
          } @empty {
            <p class="empty">
              @if (hasFilters()) {
                No transactions match these filters in {{ monthName(month()) }}.
              } @else {
                No transactions in {{ monthName(month()) }} yet.
              }
            </p>
          }
        </div>
      } @else if (transactions.isLoading()) {
        <p class="loading" role="status">Loading transactions…</p>
      }
    </div>

    @if (categories.hasValue()) {
      <app-transaction-form [month]="month()" [categories]="categories.value()" (saved)="onSaved($event)" />
    }
    <app-confirm-dialog />
  `,
  styles: `
    .notice { display: flex; gap: 10px; align-items: flex-start; }
    .totals { display: flex; flex-wrap: wrap; gap: 8px 24px; padding: 10px 16px; border-radius: 12px; background: var(--st-surface); border: 1px solid var(--st-line); }
    .totals p { display: flex; gap: 8px; align-items: baseline; }
    .totals .money, .totals .num { font-weight: 650; }
    .groups { display: grid; gap: 20px; }
    .group { display: grid; gap: 6px; }
    .day { font-family: var(--st-font-body); font-size: 0.8rem; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: var(--st-ink-muted); }
    .items { list-style: none; margin: 0; padding: 0; background: var(--st-surface); border: 1px solid var(--st-line); border-radius: 12px; }
    .item { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px 16px; padding: 10px 12px 10px 16px; }
    .item + .item { border-top: 1px solid var(--st-line); }
    .payee { font-weight: 550; overflow-wrap: anywhere; }
    .meta { font-size: 0.85rem; overflow-wrap: anywhere; }
    .amount { font-weight: 650; text-align: right; }
    .income { color: var(--st-green); }
    .actions { display: flex; gap: 2px; }
    @media (max-width: 560px) {
      .item { grid-template-columns: minmax(0, 1fr) auto; }
      .actions { grid-column: 1 / -1; justify-content: flex-end; margin-top: -6px; }
    }
  `,
})
export class TransactionList {
  private readonly transactionApi = inject(TransactionApi);
  private readonly categoryApi = inject(CategoryApi);
  private readonly budgetApi = inject(BudgetApi);
  private readonly notifier = inject(Notifier);
  private readonly form = viewChild(TransactionForm);
  private readonly confirm = viewChild.required(ConfirmDialog);

  /** Bound from the `:month` route param. */
  readonly month = input.required<string>();

  protected readonly filters = signal<TransactionFilters>({});
  protected readonly transactions = this.transactionApi.transactionsResource(this.month, this.filters);
  protected readonly categories = this.categoryApi.categoriesResource();
  protected readonly budget = this.budgetApi.budgetResource(this.month);

  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly isClosed = computed(() => this.budget.hasValue() && this.budget.value().status === 'closed');
  protected readonly hasFilters = computed(() => Object.values(this.filters()).some((v) => v !== undefined));
  protected readonly loadError = computed(() => errorMessage(this.transactions.error()));

  protected readonly groups = computed<DateGroup[]>(() => {
    if (!this.transactions.hasValue()) return [];
    const groups: DateGroup[] = [];
    for (const tx of this.transactions.value()) {
      let group = groups.at(-1);
      if (!group || group.date !== tx.date) {
        group = { date: tx.date, label: dateFormat.format(new Date(`${tx.date}T00:00:00Z`)), items: [] };
        groups.push(group);
      }
      group.items.push(tx);
    }
    return groups;
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
    return `${formatCents(tx.amountCents)} ${tx.payee ?? tx.subcategoryName} on ${tx.date}`;
  }

  protected add(): void {
    this.form()?.open(null);
  }

  protected edit(tx: TransactionDto): void {
    this.form()?.open(tx);
  }

  protected onSaved(tx: TransactionDto): void {
    this.notifier.success(`Saved ${formatCents(tx.amountCents)} ${tx.payee ?? tx.subcategoryName}.`);
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
