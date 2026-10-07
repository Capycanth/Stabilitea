import { Component, computed, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BudgetApi } from '../budget/budget-api';
import { errorMessage } from '../shared/api-error';
import { ConfirmDialog } from '../shared/confirm-dialog';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';
import { addMonths, currentMonth, monthLabel, monthName } from '../shared/month';
import { Notifier } from '../shared/notifier';
import { CategoryCard } from './category-card';

@Component({
  selector: 'app-overview',
  imports: [RouterLink, CategoryCard, Icon, MoneyPipe, ConfirmDialog],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Overview</p>
          <h1>{{ label() }}</h1>
        </div>
        @if (summary.hasValue()) {
          @if (summary.value().status === 'closed') {
            <span class="chip"><app-icon name="lock" [size]="13" />Closed</span>
          } @else {
            <span class="chip chip-green">Open</span>
          }
        }
      </div>

      @if (summary.error() && !summary.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (summary.hasValue()) {
        @let s = summary.value();

        @if (showCloseBanner()) {
          <section class="banner" aria-labelledby="close-banner-title">
            <app-icon name="info" />
            <div class="banner-text">
              <h2 id="close-banner-title">Close {{ monthName(s.month) }} to update savings.</h2>
              <p>Closing adds its income to savings, takes out regular spending and fund contributions, and carries fund balances into {{ nextMonthLabel() }}.</p>
            </div>
            <button type="button" class="btn btn-primary" [disabled]="closing()" (click)="closeMonth()">
              Close {{ monthName(s.month) }}
            </button>
          </section>
        } @else if (s.earliestOpenPastMonth; as openMonth) {
          <section class="banner" aria-labelledby="open-banner-title">
            <app-icon name="info" />
            <div class="banner-text">
              <h2 id="open-banner-title">Close {{ monthName(openMonth) }} to update savings.</h2>
              <p>{{ monthLabel(openMonth) }} is still open, so its income, spending and fund balances haven't reached savings yet.</p>
            </div>
            <a class="btn" [routerLink]="['/', openMonth]">Go to {{ monthName(openMonth) }}</a>
          </section>
        }

        <section class="stats" aria-label="Month totals">
          <div class="card-deep stat">
            <p class="stat-label">Income</p>
            <p class="stat-value money income">{{ s.incomeCents | money }}</p>
            <p class="stat-sub muted">
              @if (s.plannedIncomeCents > 0) {
                of <span class="money">{{ s.plannedIncomeCents | money }}</span> planned
              } @else {
                No planned income set
              }
            </p>
          </div>
          <div class="card-deep stat">
            <p class="stat-label">Expenses</p>
            <p class="stat-value money">{{ s.expenseCents | money }}</p>
            <p class="stat-sub muted">of <span class="money">{{ totalAvailable() | money }}</span> budgeted</p>
          </div>
          <div class="card-deep stat">
            <p class="stat-label">Net</p>
            <p class="stat-value money" [class.income]="s.netCents >= 0" [class.negative]="s.netCents < 0">
              {{ s.netCents | money }}
            </p>
            <p class="stat-sub" [class.muted]="s.netCents >= 0" [class.negative]="s.netCents < 0">
              @if (s.netCents < 0) {
                <app-icon name="warning" [size]="14" /> Spending exceeds income
              } @else {
                Income minus expenses
              }
            </p>
          </div>
          <div class="card-deep stat">
            <p class="stat-label">{{ s.status === 'closed' ? 'Change in savings' : 'Savings change if closed' }}</p>
            <p class="stat-value money" [class.income]="s.savingsChangeCents >= 0" [class.negative]="s.savingsChangeCents < 0">
              {{ s.savingsChangeCents | money }}
            </p>
            <p class="stat-sub muted">
              @if (s.fundContributionCents > 0) {
                After <span class="money">{{ s.fundContributionCents | money }}</span> into funds
              } @else {
                Income minus regular spending
              }
            </p>
          </div>
        </section>

        <section class="stack" aria-labelledby="categories-title">
          <div class="row between">
            <h2 id="categories-title">Budget vs. actual</h2>
            <a class="btn btn-sm" [routerLink]="['/', s.month, 'budget']">Edit budget</a>
          </div>
          <div class="grid">
            @for (category of s.categories; track category.id) {
              <app-category-card [category]="category" />
            } @empty {
              <p class="empty">
                No expense categories yet. <a routerLink="/categories">Add categories</a> to start budgeting.
              </p>
            }
          </div>
        </section>
      } @else if (summary.isLoading()) {
        <p class="loading" role="status">Loading {{ label() }}…</p>
      }
    </div>
    <app-confirm-dialog />
  `,
  styles: `
    .banner { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 14px 18px; border-radius: 12px; background: #fbe6d6; border: 1px solid #f3cdb2; color: #5e2b10; }
    .banner-text { flex: 1 1 260px; display: grid; gap: 2px; }
    .banner h2 { font-family: var(--st-font-body); font-size: 1rem; font-weight: 650; color: inherit; }
    .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; }
    .stat { display: grid; gap: 2px; }
    .stat-label { font-size: 0.85rem; font-weight: 600; color: var(--st-ink-muted); }
    .stat-value { font-size: 1.75rem; font-weight: 650; letter-spacing: -0.01em; }
    .stat-sub { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; }
    .income { color: var(--st-green); }
    .negative { color: var(--st-orange); }
    .between { justify-content: space-between; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; }
    .grid .empty { grid-column: 1 / -1; }
  `,
})
export class Overview {
  private readonly budgetApi = inject(BudgetApi);
  private readonly notifier = inject(Notifier);
  private readonly dialog = viewChild.required(ConfirmDialog);

  /** Bound from the `:month` route param. */
  readonly month = input.required<string>();

  protected readonly summary = this.budgetApi.summaryResource(this.month);
  protected readonly closing = signal(false);

  protected readonly label = computed(() => monthLabel(this.month()));
  protected readonly nextMonthLabel = computed(() => monthLabel(addMonths(this.month(), 1)));
  protected readonly loadError = computed(() => errorMessage(this.summary.error()));
  protected readonly totalAvailable = computed(() =>
    this.summary.hasValue() ? this.summary.value().categories.reduce((sum, c) => sum + c.availableCents, 0) : 0,
  );
  /** A past month that is still open, with no earlier open month blocking it. */
  protected readonly showCloseBanner = computed(
    () =>
      this.summary.hasValue() &&
      this.summary.value().status === 'open' &&
      this.month() < currentMonth() &&
      this.summary.value().earliestOpenPastMonth === null,
  );

  protected readonly monthName = monthName;
  protected readonly monthLabel = monthLabel;

  protected async closeMonth(): Promise<void> {
    const month = this.month();
    const ok = await this.dialog().ask({
      title: `Close ${monthLabel(month)}?`,
      message: `Closing adds this month's income to savings and takes out regular spending and fund contributions. Each fund's balance carries into ${monthLabel(addMonths(month, 1))}, even if it's negative. You can reopen it later to make corrections.`,
      confirmLabel: `Close ${monthName(month)}`,
    });
    if (!ok) return;
    this.closing.set(true);
    try {
      await this.budgetApi.close(month);
      this.notifier.success(`${monthLabel(month)} closed. Savings and funds updated.`);
      this.summary.reload();
    } catch (error) {
      this.notifier.error(errorMessage(error));
    } finally {
      this.closing.set(false);
    }
  }
}
