import { Component, computed, inject } from '@angular/core';
import type { SavingsEntryDto, SavingsEntryKind, SavingsMonthDto } from '@stabilitea/shared';
import { errorMessage } from '../shared/api-error';
import { Icon } from '../shared/icon';
import { MoneyPipe } from '../shared/money-pipe';
import { monthLabel } from '../shared/month';
import { SavingsApi } from './savings-api';

interface MonthGroup {
  month: SavingsMonthDto;
  label: string;
  entries: SavingsEntryDto[];
}

const KIND_LABEL: Record<SavingsEntryKind, string> = {
  income: 'Income',
  spending: 'Spending',
  fund_contribution: 'Into fund',
  fund_release: 'Fund released',
  deficit_payment: 'Fund deficit paid',
};

@Component({
  selector: 'app-savings-page',
  imports: [Icon, MoneyPipe],
  template: `
    <div class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Running total</p>
          <h1>Savings</h1>
        </div>
      </div>

      @if (savings.error() && !savings.hasValue()) {
        <p class="form-error" role="alert"><app-icon name="warning" />{{ loadError() }}</p>
      }

      @if (savings.hasValue()) {
        @let s = savings.value();
        <section class="balance" aria-labelledby="balance-label">
          <app-icon name="savings" [size]="34" />
          <div>
            <p id="balance-label" class="balance-label">Savings balance</p>
            <p class="balance-value money" [class.negative]="s.balanceCents < 0">{{ s.balanceCents | money }}</p>
          </div>
          <p class="balance-note">
            Closing a month adds its income and takes out regular spending and the money moved into funds. Paying a fund's
            deficit from the Budget page also comes out of savings.
          </p>
        </section>

        @if (s.funds.length) {
          <section class="stack" aria-labelledby="funds-title">
            <div>
              <h2 id="funds-title">Funds</h2>
              <p class="hint">Each fund keeps its own balance. Shown as of the latest closed month, including deficits paid since.</p>
            </div>
            <ul class="funds">
              @for (fund of s.funds; track fund.subcategoryId) {
                <li class="card-deep fund">
                  <span class="fund-name">{{ fund.subcategoryName }}</span>
                  <span class="muted small">{{ fund.categoryName }}</span>
                  <span class="money fund-balance" [class.negative]="fund.balanceCents < 0">
                    @if (fund.balanceCents < 0) {
                      <app-icon name="warning" [size]="14" /><span class="visually-hidden">Deficit</span>
                    }
                    {{ fund.balanceCents | money }}
                  </span>
                </li>
              }
            </ul>
          </section>
        }

        <section class="stack" aria-labelledby="history-title">
          <h2 id="history-title">History</h2>
          @for (group of groups(); track group.month.month) {
            @let m = group.month;
            <div class="card month">
              <div class="month-head">
                <h3>{{ group.label }}</h3>
                <p class="money total" [class.negative]="m.changeCents < 0">{{ m.changeCents >= 0 ? '+' : '' }}{{ m.changeCents | money }}</p>
              </div>
              <dl class="flows">
                <div><dt>Income</dt><dd class="money">{{ m.incomeCents | money }}</dd></div>
                <div><dt>Regular spending</dt><dd class="money">{{ m.spendingCents | money }}</dd></div>
                <div><dt>Into funds</dt><dd class="money">{{ m.fundContributionCents | money }}</dd></div>
                @if (m.fundReleaseCents !== 0) {
                  <div><dt>Released from funds</dt><dd class="money">{{ m.fundReleaseCents | money }}</dd></div>
                }
                @if (m.deficitPaidCents > 0) {
                  <div><dt>Fund deficits paid</dt><dd class="money">{{ m.deficitPaidCents | money }}</dd></div>
                }
                <div><dt>Balance after</dt><dd class="money" [class.negative]="m.balanceAfterCents < 0">{{ m.balanceAfterCents | money }}</dd></div>
              </dl>
              <details>
                <summary>{{ group.entries.length }} {{ group.entries.length === 1 ? 'entry' : 'entries' }}</summary>
                <table class="table">
                  <caption class="visually-hidden">Savings entries for {{ group.label }}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Type</th>
                      <th scope="col" class="end">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (entry of group.entries; track entry.id) {
                      <tr>
                        <td>
                          @if (entry.subcategoryName) {
                            {{ entry.subcategoryName }} <span class="muted">· {{ entry.categoryName }}</span>
                          } @else {
                            <span class="muted">Removed subcategory</span>
                          }
                        </td>
                        <td>
                          <span class="chip" [class.chip-green]="entry.amountCents >= 0" [class.chip-orange]="entry.amountCents < 0">
                            {{ kindLabel[entry.kind] }}
                          </span>
                        </td>
                        <td class="end money">{{ entry.amountCents >= 0 ? '+' : '' }}{{ entry.amountCents | money }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </details>
            </div>
          } @empty {
            <p class="empty">No savings activity yet. Close a month to add its income and spending here.</p>
          }
        </section>
      } @else if (savings.isLoading()) {
        <p class="loading" role="status">Loading savings…</p>
      }
    </div>
  `,
  styles: `
    .balance { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; padding: 20px 24px; border-radius: 12px; background: #fce9dc; border: 1px solid var(--st-orange-soft); color: var(--st-ink); }
    .balance app-icon { color: var(--st-orange); }
    .balance-label { font-size: 0.9rem; font-weight: 600; color: var(--st-ink-muted); }
    .balance-value { font-size: 2.2rem; font-weight: 700; letter-spacing: -0.01em; }
    .balance-note { flex: 1 1 260px; font-size: 0.9rem; color: var(--st-ink-muted); }
    .negative { color: var(--st-orange); }
    .small { font-size: 0.82rem; }
    .funds { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
    .fund { display: grid; gap: 2px; }
    .fund-name { font-weight: 600; }
    .fund-balance { display: inline-flex; align-items: center; gap: 4px; font-size: 1.35rem; font-weight: 650; }
    .month { padding: 16px 20px; display: grid; gap: 10px; }
    .month-head { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .total { font-weight: 650; color: var(--st-green); }
    .total.negative { color: var(--st-orange); }
    .flows { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px 16px; margin: 0; }
    .flows dt { font-size: 0.78rem; font-weight: 600; color: var(--st-ink-muted); }
    .flows dd { margin: 0; font-weight: 600; }
    details summary { cursor: pointer; font-size: 0.88rem; color: var(--st-ink-muted); font-weight: 600; padding: 4px 0; }
    details summary:focus-visible { outline: 2px solid var(--st-green); outline-offset: 2px; border-radius: 4px; }
    .table tr:last-child td { border-bottom: 0; }
    @media (max-width: 560px) {
      .month { padding: 12px; }
      .table th, .table td { padding: 8px 6px; }
      .table .chip { white-space: normal; }
    }
  `,
})
export class SavingsPage {
  private readonly api = inject(SavingsApi);

  protected readonly savings = this.api.savingsResource();
  protected readonly loadError = computed(() => errorMessage(this.savings.error()));
  protected readonly kindLabel = KIND_LABEL;

  protected readonly groups = computed<MonthGroup[]>(() => {
    if (!this.savings.hasValue()) return [];
    const { months, entries } = this.savings.value();
    return months.map((month) => ({
      month,
      label: monthLabel(month.month),
      entries: entries.filter((e) => e.month === month.month),
    }));
  });
}
